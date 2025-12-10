require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
// 1. IMPORT MULTER (Wajib untuk handle upload file)
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;

// Konfigurasi Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 2. KONFIGURASI MULTER
// Gunakan memoryStorage agar file bisa langsung diupload ke Supabase tanpa disimpan di disk server
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// --- ROUTES ---

// Halaman Utama
app.get('/', async (req, res) => {
    const userId = req.query.user_id;

    if (!userId) {
        return res.render('index', { mode: 'auth', user: null, invitations: [] });
    }

    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    const { data: invitations } = await supabase.from('invitations').select('*').eq('user_id', userId);

    res.render('index', { 
        mode: 'dashboard', 
        user: user, 
        invitations: invitations || [] 
    });
});

// Proses Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.from('users').select('*').eq('email', email).eq('password', password).single();

    if (error || !data) {
        return res.render('index', { mode: 'auth', error: 'Email atau password salah!', user: null });
    }
    res.redirect(`/?user_id=${data.id}`);
});

// Proses Register
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    const { data: existing } = await supabase.from('users').select('*').eq('email', email).single();
    if (existing) {
        return res.render('index', { mode: 'auth', error: 'Email sudah terdaftar!', section: 'register', user: null });
    }

    const { data, error } = await supabase.from('users').insert([{ name, email, password }]).select().single();
    if (error) return res.send(error.message);

    res.redirect(`/?user_id=${data.id}`);
});

// Halaman Buat Undangan
app.get('/create', async (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.redirect('/');
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    res.render('index', { mode: 'create', user: user });
});

// 3. DEFINISI MIDDLEWARE UPLOAD
// Ini memberi tahu server field mana saja yang berisi file
const galleryUpload = upload.fields([
    { name: 'gallery_1', maxCount: 1 },
    { name: 'gallery_2', maxCount: 1 },
    { name: 'gallery_3', maxCount: 1 },
    { name: 'gallery_4', maxCount: 1 }
]);

// 4. TERAPKAN MIDDLEWARE DI RUTE '/create'
// 'galleryUpload' harus ada sebelum (req, res) agar req.body bisa terbaca
app.post('/create', galleryUpload, async (req, res) => {
    try {
        // req.body sekarang sudah bisa dibaca berkat multer
        const userId = req.body.user_id; 

        // Helper function untuk upload file ke Supabase Storage
        const uploadFile = async (fileObject) => {
            if (!fileObject) return null;
            const file = fileObject[0];
            // Bersihkan nama file dari karakter aneh
            const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
            const fileName = `${Date.now()}-${cleanName}`;
            
            // Upload ke bucket 'images'
            const { data, error } = await supabase.storage
                .from('images')
                .upload(fileName, file.buffer, {
                    contentType: file.mimetype
                });
                
            if (error) {
                console.error('Upload Error:', error);
                return null;
            }

            // Dapatkan Public URL
            const { data: publicUrlData } = supabase.storage.from('images').getPublicUrl(fileName);
            return publicUrlData.publicUrl;
        };

        // Proses upload galeri
        const galleryUrls = [];
        const files = req.files || {};
        
        if (files.gallery_1) galleryUrls.push(await uploadFile(files.gallery_1));
        if (files.gallery_2) galleryUrls.push(await uploadFile(files.gallery_2));
        if (files.gallery_3) galleryUrls.push(await uploadFile(files.gallery_3));
        if (files.gallery_4) galleryUrls.push(await uploadFile(files.gallery_4));

        // Susun data Love Story
        const loveStory = [];
        for(let i=1; i<=3; i++) {
            if(req.body[`story_title_${i}`]) {
                loveStory.push({
                    year: req.body[`story_year_${i}`],
                    title: req.body[`story_title_${i}`],
                    content: req.body[`story_content_${i}`]
                });
            }
        }

        const { error } = await supabase.from('invitations').insert([{
            user_id: userId,
            groom_name: req.body.groomName,
            groom_nick: req.body.groomNick,
            bride_name: req.body.brideName,
            bride_nick: req.body.brideNick,
            event_date: req.body.eventDate,
            location: req.body.location,
            message: req.body.message,
            love_story: loveStory, 
            gallery: galleryUrls
        }]);

        if (error) throw error;

        res.redirect(`/?user_id=${userId}`);

    } catch (error) {
        console.error("Server Error:", error);
        res.send("Gagal membuat undangan: " + error.message);
    }
});

// Halaman Public
app.get('/u/:id', async (req, res) => {
    const { data: invite, error } = await supabase.from('invitations').select('*').eq('id', req.params.id).single();
    if (error || !invite) return res.send("Undangan tidak ditemukan");
    res.render('index', { mode: 'view', invitation: invite });
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});