# Evertech Mod Studio

**Editor 3D berbasis browser untuk menyiapkan aset dan paket mod Evertech Sandbox (EVTS).**

[English version](README_EN.md)

Evertech Mod Studio berjalan di browser pengguna dan tidak memerlukan akun. Repositori ini adalah versi pengembangan multi-file dari prototipe v0.7.

> **Status: eksperimental.** Anggap hasil ekspor sebagai draft. Periksa `info.json`, path mesh, tekstur, pengaturan collider, dan isi paket ZIP, lalu uji di versi Evertech Sandbox yang dituju. Proyek ini tidak berafiliasi dengan atau didukung oleh pengembang Evertech Sandbox.

## Fitur saat ini

- Impor aset model yang didukung dan inspeksi mesh di workspace 3D berbasis browser.
- Mengelola mesh melalui Outliner dan mengubah transformasi objek.
- Mengatur material dan metadata collider per item.
- Mengedit serta memvalidasi JSON konfigurasi mod.
- Ekspor OBJ per mesh atau gabungan, susun aset, dan buat arsip ZIP.
- Pilihan kompresi ZIP **Fast**, **Balanced**, dan **Smaller ZIP**.
- Progres ekspor; serialisasi OBJ untuk model cukup besar dapat memakai Web Worker jika didukung browser, dengan jalur fallback.
- Ekspor folder pada browser yang mendukung File System Access API (umumnya melalui `localhost` atau HTTPS).

Dukungan format model dan fitur tertentu dapat berbeda antar-browser. OBJ adalah format mesh statis; animasi dan rigging tidak dipertahankan oleh ekspor OBJ.

## Menjalankan secara lokal

Tidak ada proses build atau dependensi npm yang diperlukan untuk penggunaan normal. Server lokal direkomendasikan, terutama untuk menguji Web Worker dan ekspor folder.

### Dengan Python

Jalankan dari folder utama repositori:

```bash
python -m http.server 8080
```

Buka <http://localhost:8080>.

### Dengan Node.js

```bash
npx serve .
```

Buka URL lokal yang ditampilkan oleh server.

`index.html` bisa dibuka langsung untuk pemeriksaan dasar, tetapi browser membatasi beberapa API ketika memakai `file://`. Gunakan server lokal saat menguji impor dan ekspor.

## Menayangkan lewat GitHub Pages

Repositori ini berupa situs statis tanpa build step. Di GitHub, buka **Settings → Pages**, pilih branch yang digunakan dan folder root (`/`), lalu simpan. Setelah dipublikasikan, buka URL Pages yang disediakan GitHub.

## Struktur repositori

```text
EvertechModStudio/
├── index.html                  # Markup UI dan struktur halaman
├── css/styles.css              # Seluruh styling aplikasi
├── js/app.js                  # Logika aplikasi dan event handler
├── vendor/jszip.min.js         # JSZip 3.10.1 untuk membuat ZIP
├── scripts/check-project.mjs   # Pemeriksaan statis tanpa dependensi tambahan
├── docs/ARCHITECTURE.md        # Peta kode dan panduan debugging
├── .github/                    # Template issue/PR dan GitHub Actions
├── README.md                   # Dokumentasi Bahasa Indonesia
├── README_EN.md                # English README
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── NOTICE.md
├── LICENSE
└── package.json
```

### Mengapa logika aplikasi belum dipecah menjadi banyak modul JavaScript?

Pemisahan tahap pertama memisahkan HTML, CSS, library pihak ketiga, dan logika aplikasi tanpa mengubah model eksekusi internal. Ini membuat prototipe lebih mudah dijalankan dan mengurangi risiko merusak state bersama pada rilis open-source awal. Refactor berikutnya bisa memisahkan parser model, renderer viewport, konfigurasi, dan exporter menjadi modul yang punya batas dan pengujian jelas.

## Pengembangan dan pemeriksaan

Gunakan Node.js 18 atau lebih baru untuk skrip pemeriksaan repositori. Aplikasi tetap berjalan di browser dan tidak membutuhkan Node.js saat sudah disajikan sebagai situs.

```bash
npm test
```

Pemeriksaan ini memvalidasi file dan referensi penting serta mem-parsing JavaScript untuk mendeteksi kesalahan sintaks. Ini **bukan** pengganti pengujian di browser dan tidak membuktikan bahwa setiap hasil ekspor diterima oleh game.

Pengujian manual yang disarankan:

1. Buka aplikasi di browser desktop dan viewport sempit/mobile.
2. Impor model kecil yang didukung, lalu cek nama mesh dan transformasi.
3. Ubah konfigurasi dan jalankan validasi.
4. Ekspor ZIP dalam mode Fast, ekstrak, lalu periksa path OBJ dan `info.json`.
5. Uji Balanced dan Smaller ZIP dengan proyek salinan yang sama, kemudian bandingkan waktu dan ukuran file.
6. Uji paket di versi game yang dituju sebelum mengklaim kompatibilitas.

## Melaporkan bug

Sertakan versi browser/OS, langkah reproduksi, perilaku yang diharapkan dan yang terjadi, file contoh sekecil mungkin yang menunjukkan masalah (hanya bagikan aset yang boleh Anda distribusikan), serta teks error Console jika ada. Jangan lampirkan kata sandi, token, atau aset proyek privat.

## Lisensi

Kode aplikasi di repositori ini menggunakan lisensi MIT. Kode pihak ketiga dan noticenya dijelaskan dalam [NOTICE.md](NOTICE.md); lisensi masing-masing komponen pihak ketiga tetap berlaku.
