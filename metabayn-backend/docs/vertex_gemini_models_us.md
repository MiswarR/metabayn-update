# Vertex AI - Gemini Vision Models (Region US-Central1)

Valid berdasarkan pengujian server mode (service account) di proyek ini:

- Aktif dan terverifikasi:
  - gemini-2.5-flash
  - gemini-2.5-pro
  - gemini-2.0-flash

- Tidak tersedia/404 atau prasyarat belum terpenuhi (dinonaktifkan sementara di UI):
  - gemini-3.0-flash-preview
  - gemini-3.0-pro-preview
  - gemini-3.0-ultra
  - gemini-2.5-flash-lite
  - gemini-2.5-ultra
  - gemini-2.0-pro (alias gemini-2.0-pro-exp-02-05)
  - gemini-2.0-ultra
  - gemini-2.0-flash-lite-preview-02-05
  - gemini-1.5-pro (alias gemini-1.5-pro-002)
  - gemini-1.5-flash (alias gemini-1.5-flash-002)
  - gemini-1.5-flash-8b
  - gemini-1.0-pro

Catatan:
- Endpoint ListModels publishers/google/models pada region ini dapat mengembalikan 404 walau generateContent berfungsi.
- Pengujian vision menggunakan inline_data image PNG/JPEG membutuhkan payload gambar valid; placeholder 1x1 tidak diterima oleh Vertex (INVALID_ARGUMENT). Pengujian produksi dengan gambar nyata pada pipeline Anda telah bekerja untuk model yang aktif.

Cara uji cepat:
- GET /admin/debug/vertex/test?model=<ID>&prompt=hi
- GET /admin/debug/vertex/test-vision?model=<ID>&prompt=describe
- Default region: us-central1. Override dengan ?location=<region> bila perlu.
