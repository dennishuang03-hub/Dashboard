# Letakkan workbook Anda di sini

Taruh satu file laporan Excel di folder ini — `.xlsx`, `.xlsm`, `.xls`, atau `.csv` —
dan dashboard akan memuatnya otomatis setiap kali dibuka. Tidak perlu mengunggah lagi.

```
src/assets/Data/laporan.xlsx
```

Beberapa catatan:

- **Satu file saja.** Kalau ada lebih dari satu, yang dipakai adalah yang pertama
  menurut urutan nama file.
- **Folder ini boleh kosong.** Kalau tidak ada workbook di sini, dashboard tampil
  seperti biasa dengan layar unggah — build tetap jalan.
- **Tombol "Unggah Excel" tetap berfungsi** dan menimpa file bawaan ini untuk
  sesi tersebut. Refresh halaman untuk kembali ke file bawaan.
- File tetap dibaca **sepenuhnya di browser**. Vite hanya menyalinnya menjadi aset
  statis; tidak ada yang dikirim ke server mana pun.
- **Tetapi file ini menjadi publik begitu situsnya di-deploy.** Vite menyalinnya
  apa adanya ke `dist/assets/`, jadi siapa pun yang tahu URL-nya bisa mengunduh
  workbook utuh — bukan hanya angka yang tampil di layar. Kalau dashboard ini
  dipasang di domain yang bisa diakses umum, pastikan isi workbook memang boleh
  dilihat umum, atau taruh situsnya di belakang login/VPN.
- File juga ikut ter-commit ke repo, jadi berlaku hal yang sama untuk siapa pun
  yang punya akses ke repo ini.

Setelah menaruh file, jalankan ulang `npm run dev` supaya Vite membacanya.

