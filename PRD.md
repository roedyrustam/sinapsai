# Product Requirements Document (PRD) - SinapsAI

## 1. Visi Produk
Menciptakan "Control Plane" AI lokal berbasis NPM package (TypeScript/Node.js) yang menjembatani aplikasi pengembang dengan 200+ penyedia LLM melalui satu *Unified API*. Paket ini dirancang untuk meminimalisir *downtime* dengan otomatisasi failover, retries, dan load balancing secara lokal (*in-memory*), tanpa kompromi pada performa (<10ms overhead) maupun privasi data.

## 2. Lingkup Produk (Scope)
- **Target Pengguna**: Pengembang Backend/Fullstack, Tim DevOps.
- **Platform Dukungan**: Lingkungan berbasis Node.js dan TypeScript.
- **Batasan (Out of Scope)**: 
  - Tidak menyediakan UI Dashboard web (fokus pada core library / SDK murni).
  - Tidak mengirim telemetry / API Keys ke server cloud milik SinapsAI (100% lokal).

## 3. Fitur Utama
- **Unified API**: Berkomunikasi dengan OpenAI, Anthropic, Gemini, Azure, dsb menggunakan struktur payload yang seragam (menyerupai standar format API OpenAI).
- **Automated Fallback & Retry**: Memanggil provider/model cadangan secara otomatis (tanpa melempar error ke klien) jika terjadi *downtime* atau *timeout* pada provider utama.
- **Load Balancing**: Merutekan traffic permintaan LLM ke sejumlah API Key atau endpoint yang berbeda secara rotasi (*Round Robin*) untuk menghindari pembatasan *Rate Limits* (Error 429).
- **In-Memory Circuit Breaker**: Memutuskan rute permintaan ke provider yang secara konstan gagal (*Open Circuit*) hingga provider tersebut stabil kembali.

## 4. Non-Functional Requirements (NFR)
- **Performa Eksekusi**: Overhead proses internal harus sekecil mungkin (<10ms).
- **Dependensi Eksternal**: Minimal. Diupayakan memanfaatkan standar runtime web seperti native `fetch`.
- **Manajemen State**: Berjalan *in-memory* untuk menghindari keharusan pengembang men-setup Redis atau database tambahan.
