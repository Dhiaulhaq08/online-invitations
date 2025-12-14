require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;

// --- KONFIGURASI SUPABASE ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- KONFIGURASI MULTER (UPLOAD) ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ================= ROUTES =================

// 1. DASHBOARD & LOGIN
app.get('/', async (req, res) => {
    const userId = req.query.user_id;

    if (!userId) {
        return res.render('index', { mode: 'auth', user: null, invitations: [] });
    }

    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    const { data: invitations } = await supabase
        .from('invitations')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    res.render('index', { 
        mode: 'dashboard', 
        user: user, 
        invitations: invitations || [] 
    });
});

// 2. PROSES LOGIN
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.from('users').select('*').eq('email', email).eq('password', password).single();

    if (error || !data) {
        return res.render('index', { mode: 'auth', error: 'Email atau password salah!', user: null });
    }
    res.redirect(`/?user_id=${data.id}`);
});

// 3. PROSES REGISTER
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

// 4. HALAMAN CREATE UNDANGAN
app.get('/create', async (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.redirect('/');
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    res.render('index', { mode: 'create', user: user });
});

// Middleware Multer untuk menangani banyak file (Galeri + Foto Profil)
const formUploads = upload.fields([
    { name: 'groomPhoto', maxCount: 1 }, // Foto Mempelai Pria
    { name: 'bridePhoto', maxCount: 1 }, // Foto Mempelai Wanita
    { name: 'gallery_1', maxCount: 1 },
    { name: 'gallery_2', maxCount: 1 },
    { name: 'gallery_3', maxCount: 1 },
    { name: 'gallery_4', maxCount: 1 }
]);

// 5. PROSES SIMPAN UNDANGAN (UPLOAD + DATA)
app.post('/create', formUploads, async (req, res) => {
    try {
        const userId = req.body.user_id; 
        const files = req.files || {};

        // Fungsi Helper Upload ke Supabase Storage
        const uploadFile = async (fileObject) => {
            if (!fileObject) return null;
            const file = fileObject[0];
            const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
            const fileName = `${Date.now()}-${cleanName}`;
            
            const { data, error } = await supabase.storage
                .from('images')
                .upload(fileName, file.buffer, { contentType: file.mimetype });
                
            if (error) { console.error('Upload Error:', error); return null; }

            const { data: publicUrlData } = supabase.storage.from('images').getPublicUrl(fileName);
            return publicUrlData.publicUrl;
        };

        // Upload Foto Profil
        const groomPhotoUrl = files.groomPhoto ? await uploadFile(files.groomPhoto) : null;
        const bridePhotoUrl = files.bridePhoto ? await uploadFile(files.bridePhoto) : null;

        // Upload Galeri
        const galleryUrls = [];
        if (files.gallery_1) galleryUrls.push(await uploadFile(files.gallery_1));
        if (files.gallery_2) galleryUrls.push(await uploadFile(files.gallery_2));
        if (files.gallery_3) galleryUrls.push(await uploadFile(files.gallery_3));
        if (files.gallery_4) galleryUrls.push(await uploadFile(files.gallery_4));

        // Susun Data Love Story
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

        // Insert ke Database
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
            gallery: galleryUrls,
            // Data Bank
            bank_name: req.body.bankName,
            account_number: req.body.accountNumber,
            account_holder: req.body.accountHolder,
            // Foto Profil Baru
            groom_photo: groomPhotoUrl,
            bride_photo: bridePhotoUrl
        }]);

        if (error) throw error;

        res.redirect(`/?user_id=${userId}`);

    } catch (error) {
        console.error("Server Error:", error);
        res.send("Gagal membuat undangan: " + error.message);
    }
});

// 6. HALAMAN PUBLIC (TAMPILAN TAMU)
app.get('/u/:id', async (req, res) => {
    const { data: invite, error } = await supabase.from('invitations').select('*').eq('id', req.params.id).single();
    if (error || !invite) return res.send("Undangan tidak ditemukan");

    const { data: comments } = await supabase
        .from('comments')
        .select('*')
        .eq('invitation_id', req.params.id)
        .order('created_at', { ascending: false });

    res.render('invite', { 
        invitation: invite,
        comments: comments || [] 
    });
});

// 7. PROSES KIRIM KOMENTAR
app.post('/u/:id/comment', async (req, res) => {
    const invitationId = req.params.id;
    const { guest_name, message, attendance } = req.body;

    const { error } = await supabase.from('comments').insert([{
        invitation_id: invitationId,
        guest_name: guest_name,
        message: message,
        attendance: attendance
    }]);

    if (error) return res.send("Gagal mengirim ucapan.");
    res.redirect(`/u/${invitationId}#wishes`);
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});