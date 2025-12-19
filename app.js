require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const multer = require('multer');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.static('public')); 

// --- 1. KONFIGURASI SUPABASE ---
// Pastikan file .env Anda berisi SUPABASE_URL dan SUPABASE_KEY
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- 2. KONFIGURASI MULTER (UPLOAD FILE) ---
// Kita menggunakan memoryStorage agar file tidak disimpan di server, tapi langsung diteruskan ke Supabase
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- 3. MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public')); // Folder untuk file statis (css/js/img) jika ada
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());


// Tambahkan baris ini:
app.use(express.static('public')); 

// ... sisa kode routing Anda



// ================= RUTE UTAMA (DASHBOARD & AUTH) =================

// GET / - Menangani Halaman Utama (Login, Dashboard User, Dashboard Admin)
app.get('/', async (req, res) => {
    const userId = req.query.user_id;
    const role = req.query.role;

    // A. JIKA BELUM LOGIN -> TAMPILKAN AUTH (LOGIN/REGISTER)
    if (!userId) {
        return res.render('index', { mode: 'auth', user: null, invitations: [] });
    }

    // B. JIKA LOGIN SEBAGAI SUPER ADMIN
    if (role === 'admin' && userId === 'super-admin-id') {
        // Ambil semua user untuk dikelola
        const { data: allUsers } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        return res.render('index', { 
            mode: 'superadmin', 
            user: { name: 'Super Admin' }, // Dummy user object
            users: allUsers || [] 
        });
    }

    // C. JIKA LOGIN SEBAGAI USER BIASA
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    
    // Cek apakah user ada dan sudah diverifikasi
    if (!user) {
        return res.render('index', { mode: 'auth', error: 'User tidak ditemukan.', user: null });
    }
    if (!user.is_verified) {
        return res.render('index', { mode: 'auth', error: 'Akun Anda belum diverifikasi oleh Admin. Silakan tunggu.', user: null });
    }

    // Ambil daftar undangan milik user ini
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

// POST /login - Proses Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body; // Note: 'email' di form juga bisa diisi 'admin'

    // 1. CEK SUPER ADMIN (Hardcoded)
    if (email === 'admin' && password === 'admin04') {
        return res.redirect(`/?user_id=super-admin-id&role=admin`);
    }

    // 2. CEK USER DI DATABASE
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .eq('password', password)
        .single();

    if (error || !data) {
        return res.render('index', { mode: 'auth', error: 'Email atau password salah!', user: null });
    }

    // 3. CEK STATUS VERIFIKASI
    if (data.is_verified === false) {
        return res.render('index', { mode: 'auth', error: 'Login Gagal. Akun Anda masih dalam antrean verifikasi Admin.', user: null });
    }

    // Login Sukses
    res.redirect(`/?user_id=${data.id}`);
});

// POST /register - Proses Pendaftaran
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    
    // Cek email duplikat
    const { data: existing } = await supabase.from('users').select('*').eq('email', email).single();
    if (existing) {
        return res.render('index', { mode: 'auth', error: 'Email sudah terdaftar!', section: 'register', user: null });
    }

    // Insert user baru (Default is_verified: false diatur di Database)
    const { error } = await supabase.from('users').insert([{ name, email, password }]);
    
    if (error) return res.send(error.message);

    // Beri notifikasi user harus menunggu
    res.render('index', { 
        mode: 'auth', 
        error: 'Pendaftaran Berhasil! Silakan tunggu verifikasi Admin sebelum bisa login.', 
        section: 'login', // Kembali ke tab login
        user: null 
    });
});

// ================= RUTE ADMIN PANEL =================

// POST /admin/verify - Verifikasi User
app.post('/admin/verify', async (req, res) => {
    const { user_id_to_verify } = req.body;
    await supabase.from('users').update({ is_verified: true }).eq('id', user_id_to_verify);
    res.redirect(`/?user_id=super-admin-id&role=admin`);
});

// POST /admin/delete-user - Hapus User
app.post('/admin/delete-user', async (req, res) => {
    const { user_id_to_delete } = req.body;
    // Hapus undangan user dulu (opsional jika cascade delete aktif di DB)
    await supabase.from('invitations').delete().eq('user_id', user_id_to_delete);
    await supabase.from('users').delete().eq('id', user_id_to_delete);
    res.redirect(`/?user_id=super-admin-id&role=admin`);
});

// ================= RUTE MANAJEMEN UNDANGAN =================

// GET /create - Halaman Form Buat Undangan
app.get('/create', async (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.redirect('/');
    
    const { data: user } = await supabase.from('users').select('*').eq('id', userId).single();
    res.render('index', { mode: 'create', user: user });
});

// Konfigurasi Field Upload Multer
const uploadFields = upload.fields([
    { name: 'groomPhoto', maxCount: 1 },
    { name: 'bridePhoto', maxCount: 1 },
    { name: 'gallery_1', maxCount: 1 },
    { name: 'gallery_2', maxCount: 1 },
    { name: 'gallery_3', maxCount: 1 },
    { name: 'gallery_4', maxCount: 1 }
]);

// POST /create - Simpan Data Undangan & Upload File
app.post('/create', uploadFields, async (req, res) => {
    try {
        const userId = req.body.user_id; 
        const files = req.files || {};

        // Fungsi Helper: Upload Buffer ke Supabase Storage
        const uploadToSupabase = async (fileObject) => {
            if (!fileObject) return null;
            const file = fileObject[0];
            // Sanitasi nama file
            const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
            const fileName = `${Date.now()}-${cleanName}`;
            
            const { data, error } = await supabase.storage
                .from('images') // Pastikan bucket 'images' ada di Supabase
                .upload(fileName, file.buffer, { contentType: file.mimetype });
                
            if (error) { console.error('Upload Error:', error); return null; }

            const { data: publicUrlData } = supabase.storage.from('images').getPublicUrl(fileName);
            return publicUrlData.publicUrl;
        };

        // 1. Upload Foto Profil
        const groomPhotoUrl = files.groomPhoto ? await uploadToSupabase(files.groomPhoto) : null;
        const bridePhotoUrl = files.bridePhoto ? await uploadToSupabase(files.bridePhoto) : null;

        // 2. Upload Galeri
        const galleryUrls = [];
        if (files.gallery_1) galleryUrls.push(await uploadToSupabase(files.gallery_1));
        if (files.gallery_2) galleryUrls.push(await uploadToSupabase(files.gallery_2));
        if (files.gallery_3) galleryUrls.push(await uploadToSupabase(files.gallery_3));
        if (files.gallery_4) galleryUrls.push(await uploadToSupabase(files.gallery_4));

        // 3. Susun Data Love Story (Array of Objects)
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

        // 4. Insert Data Lengkap ke Database
        const { error } = await supabase.from('invitations').insert([{
            user_id: userId,
            // Mempelai
            groom_name: req.body.groomName,
            groom_nick: req.body.groomNick,
            bride_name: req.body.brideName,
            bride_nick: req.body.brideNick,
            groom_photo: groomPhotoUrl,
            bride_photo: bridePhotoUrl,
            // Acara
            event_date: req.body.eventDate,
            location: req.body.location,
            message: req.body.message,
            // Fitur Tambahan
            love_story: loveStory, 
            gallery: galleryUrls,
            // Bank
            bank_name: req.body.bankName,
            account_number: req.body.accountNumber,
            account_holder: req.body.accountHolder
        }]);

        if (error) throw error;

        // Redirect kembali ke dashboard user
        res.redirect(`/?user_id=${userId}`);

    } catch (error) {
        console.error("Server Error:", error);
        res.send("Gagal membuat undangan: " + error.message);
    }
});

// POST /delete-invitation - Hapus Undangan
app.post('/delete-invitation', async (req, res) => {
    const { invitation_id, user_id } = req.body;

    // Hapus dari database (Tabel comments akan terhapus otomatis jika Foreign Key diset ON DELETE CASCADE)
    const { error } = await supabase
        .from('invitations')
        .delete()
        .eq('id', invitation_id)
        .eq('user_id', user_id); // Validasi kepemilikan

    if (error) {
        return res.send("Gagal menghapus: " + error.message);
    }

    res.redirect(`/?user_id=${user_id}`);
});

// ================= RUTE PUBLIK (UNDANGAN TAMU) =================

// GET /u/:id - Lihat Undangan
app.get('/u/:id', async (req, res) => {
    // Ambil data undangan
    const { data: invite, error } = await supabase.from('invitations').select('*').eq('id', req.params.id).single();
    if (error || !invite) return res.send("Undangan tidak ditemukan atau URL salah.");

    // Ambil komentar tamu
    const { data: comments } = await supabase
        .from('comments')
        .select('*')
        .eq('invitation_id', req.params.id)
        .order('created_at', { ascending: false });

    // Render tampilan tamu
    res.render('invitation', { 
        invitation: invite,
        comments: comments || [] 
    });
});

// POST /u/:id/comment - Kirim Ucapan
app.post('/u/:id/comment', async (req, res) => {
    const invitationId = req.params.id;
    const { guest_name, message, attendance } = req.body;

    const { error } = await supabase.from('comments').insert([{
        invitation_id: invitationId,
        guest_name: guest_name,
        message: message,
        attendance: attendance
    }]);

    if (error) return res.send("Gagal mengirim ucapan: " + error.message);

    // Refresh halaman dan scroll ke bagian wishes
    res.redirect(`/u/${invitationId}#wishes`);
});

// --- JALANKAN SERVER ---
app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});