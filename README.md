# Super Mario — Pocket Arcade

Platformer pixel 2D bergaya Super Mario, dibangun dalam **satu file HTML**, tanpa dependency, tanpa proses build, dan tanpa koneksi internet. Tinggal buka [index.html](./index.html) di browser dan mainkan.

## ✨ Fitur

- **4 World**: 1-1 Padang Rumput, 1-2 Bawah Tanah, 1-3 Puncak Pepohonan, 1-4 Kastel Bowser (boss fight).
- **Power-up**: Mushroom (Super Mario), Fire Flower (Fire Mario, bisa menembak bola api), Star (kebal sementara).
- **Musuh klasik**: Goomba (diinjak) dan Koopa Troopa (diinjak → jadi shell → bisa ditendang).
- **Checkpoint** di tengah level, nyawa, koin, skor, dan high score tersimpan di `localStorage`.
- **Audio chiptune orisinal**: musik latar dan efek suara disintesis langsung lewat Web Audio API (tanpa file audio).
- **Grafis pixel-art** digambar langsung ke `<canvas>` lewat data sprite internal (tanpa file gambar).
- **Kontrol lengkap**: keyboard, dan tombol sentuh (touch) untuk perangkat mobile.
- **Aksesibilitas**: live region untuk status game, label ARIA pada kontrol dan progress bar.
- **Fullscreen mode**, auto-pause saat tab/jendela kehilangan fokus, dan dukungan `prefers-reduced-motion`.

## ▶️ Cara bermain

Buka file [index.html](./index.html) langsung di browser modern (Chrome, Edge, Firefox). Tidak perlu server atau instalasi apa pun.

### Kontrol

| Tombol | Aksi |
|---|---|
| `←` `→` atau `A` `D` | Bergerak kiri/kanan |
| `Space` / `↑` / `W` | Lompat (tahan untuk lompat lebih tinggi) |
| `Shift` | Sprint |
| `X` / `F` | Tembak bola api (butuh Fire Flower) |
| `P` / `Esc` | Jeda |
| `M` | Mute/unmute audio |
| `Enter` | Mulai / lanjut ke layar berikutnya |

Di perangkat layar sentuh, kontrol virtual akan muncul otomatis di bagian bawah layar.

## 🗂️ Struktur project

```
mario/
├─ index.html          # Seluruh game: HTML, CSS, dan JavaScript (engine, level, audio, rendering)
├─ tests/
│  ├─ game.test.mjs    # Test end-to-end otomatis (lihat bagian Testing)
│  └─ artifacts/       # Screenshot hasil test (dibuat otomatis)
└─ README.md
```

Semua logika game — fisika, data level, musuh, item, boss, rendering, dan audio — berada dalam satu `<script>` di [index.html](./index.html), terorganisir dalam fungsi-fungsi kecil per tanggung jawab (pembuatan level, update fisika, rendering, dsb).

## 🧪 Testing

Test otomatis dijalankan di headless Chrome lewat Chrome DevTools Protocol (CDP), tanpa dependency npm apa pun. Test ini memvalidasi:

- Integritas dan dimensi keempat map.
- Keterjangkauan (pathfinding) seluruh level, baik untuk Mario kecil maupun power-up.
- Alur penyelesaian level, bonus waktu, dan transisi antar stage.
- Checkpoint, respawn, dan platform bergerak.
- Bahaya (lava, firebar berputar) dan pertarungan boss Bowser.
- Game over, restart, serta input sentuh di perangkat mobile.
- Render visual (screenshot) di tampilan desktop dan mobile.

Jalankan dengan:

```powershell
node tests/game.test.mjs
```

> Membutuhkan Google Chrome terinstal. Jika lokasi Chrome berbeda dari default, set environment variable `CHROME_PATH` ke path executable Chrome.

## 🛠️ Teknologi

- Vanilla JavaScript (ES2020+), tanpa framework maupun library.
- HTML5 `<canvas>` untuk rendering, dengan sprite pixel-art yang di-cache ke canvas offscreen.
- Web Audio API untuk musik dan efek suara yang disintesis secara real-time.
- `localStorage` untuk menyimpan skor terbaik dan preferensi mute.
- Simulasi fisika dengan fixed timestep 60Hz, independen dari refresh rate monitor.
