require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const app = express();

// ============================================================
// 1. KONFIGURASI DAN INITIALISASI
// ============================================================

// Koneksi ke Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Konfigurasi Multer (Upload File disimpan di Memory sementara)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Batas file 5MB per foto
});

// Konfigurasi Middleware Express
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Konfigurasi Session (PENTING: Settingan agar tidak logout sendiri)
app.use(session({
    secret: 'kunci_rahasia_dapur_bunda_12345', 
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,    // HARUS FALSE jika berjalan di localhost (http)
        httpOnly: true,   
        sameSite: 'lax',  
        maxAge: 24 * 60 * 60 * 1000 // 24 jam
    }
}));

// Middleware Cek Login
const requireLogin = (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
};

// ============================================================
// 2. ROUTES AUTHENTICATION
// ============================================================

// Halaman Register
app.get('/register', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('register', { error: null });
});

// Proses Register
app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const { error } = await supabase
            .from('users')
            .insert([{ email, password: hashedPassword }]);

        if (error) throw error;
        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.render('register', { error: "Gagal mendaftar. Email mungkin sudah dipakai." });
    }
});

// Halaman Login
app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/');
    res.render('login', { error: null });
});

// Proses Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.render('login', { error: "Email atau Password salah." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('login', { error: "Email atau Password salah." });
        }

        // Set Session
        req.session.userId = user.id;
        req.session.email = user.email;
        
        // PENTING: Simpan session sebelum redirect agar tidak dianggap belum login
        req.session.save((err) => {
            if (err) {
                console.error("Session Save Error:", err);
                return res.render('login', { error: "Gagal memproses login." });
            }
            res.redirect('/');
        });

    } catch (err) {
        console.error(err);
        res.render('login', { error: "Terjadi kesalahan server." });
    }
});

// Proses Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

// ============================================================
// 3. ROUTES UTAMA
// ============================================================

// Dashboard
app.get('/', requireLogin, async (req, res) => {
    try {
        const { data: invitations, error } = await supabase
            .from('invitations')
            .select('*')
            .eq('user_id', req.session.userId)
            .order('created_at', { ascending: false });

        res.render('index', { 
            user: req.session.email, 
            invitations: invitations || [],
            error: null 
        });
    } catch (err) {
        console.error(err);
        res.send("Error memuat dashboard.");
    }
});

// Proses Buat Undangan + Upload Foto
app.post('/create', requireLogin, upload.array('photos', 10), async (req, res) => {
    const { slug, groom_name, bride_name, event_date, location, title, love_story } = req.body;
    const files = req.files;
    let uploadedUrls = [];

    // 1. Siapkan slug final di awal agar bisa dipakai untuk redirect nanti
    const rawSlug = slug || 'undangan-' + Date.now();
    const finalSlug = rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    try {
        // A. Upload Gambar ke Supabase (Looping)
        if (files && files.length > 0) {
            for (const file of files) {
                const fileExt = file.originalname.split('.').pop();
                const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileExt}`;
                
                const { error: uploadError } = await supabase
                    .storage
                    .from('invitation-images') // Pastikan nama bucket sesuai di Supabase
                    .upload(fileName, file.buffer, {
                        contentType: file.mimetype
                    });

                if (uploadError) throw uploadError;

                const { data: publicUrlData } = supabase
                    .storage
                    .from('invitation-images')
                    .getPublicUrl(fileName);

                uploadedUrls.push(publicUrlData.publicUrl);
            }
        }

        // B. Simpan ke Database
        const { error } = await supabase
            .from('invitations')
            .insert([{ 
                slug: finalSlug,
                groom_name, 
                bride_name, 
                event_date: event_date || null,
                location,
                title,
                love_story,
                gallery_urls: uploadedUrls,
                user_id: req.session.userId
            }]);

        if (error) throw error;

        // C. Simpan Session & Redirect ke Halaman Undangan
        // Menggunakan req.session.save() untuk memastikan login tidak hilang
        req.session.save((err) => {
            if (err) console.error("Session Save Error:", err);
            
            // Redirect langsung ke halaman undangan yang baru dibuat
            res.redirect(`/invitation/${finalSlug}`); 
        });

    } catch (err) {
        console.error("Gagal membuat undangan:", err);
        
        // Jika error, ambil data ulang untuk render dashboard
        const { data: invitations } = await supabase.from('invitations').select('*').eq('user_id', req.session.userId);
        
        let errorMessage = "Gagal membuat undangan.";
        if (err.code === '23505') errorMessage = "URL Undangan (Slug) sudah dipakai orang lain.";

        res.render('index', { 
            user: req.session.email, 
            invitations: invitations || [],
            error: errorMessage
        });
    }
});

// ============================================================
// 4. ROUTE PUBLIK
// ============================================================

app.get('/invitation/:slug', async (req, res) => {
    const { slug } = req.params;
    try {
        const { data, error } = await supabase
            .from('invitations')
            .select('*')
            .eq('slug', slug)
            .single();

        if (error || !data) {
            return res.status(404).send("Undangan tidak ditemukan.");
        }
        res.render('invite', { invite: data });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error.");
    }
});

// ============================================================
// 5. JALANKAN SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
});