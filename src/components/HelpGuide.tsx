import React, { useState, useEffect } from 'react';
import { WebviewWindow } from '@tauri-apps/api/window';

type Lang = 'en' | 'id';

// --- KONFIGURASI YOUTUBE CHANNEL ---
// Masukkan Channel ID Anda di sini agar video otomatis muncul dari channel.
// Jika kosong, akan menggunakan daftar manual di bawah.
// Contoh ID: UCgQY2sphgIAw7GrXYPQnYUw
const YOUTUBE_CHANNEL_ID = 'UC1FhWKSh0NzrwOkMrnS_lxA'; 

export default function HelpGuide({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState('settings');
  const [lang, setLang] = useState<Lang>('en');

  // Manual Playlist (Fallback jika Channel ID kosong atau error)
  const MANUAL_VIDEOS = [
      { id: '1', title: 'Tutorial CSV Shutterstock: Auto Isi Judul, Deskripsi & Keyword', videoId: '1HVqkK08RbY' }, 
  ];

  const [TUTORIAL_VIDEOS, setTutorialVideos] = useState(MANUAL_VIDEOS);
  const [loadingVideos, setLoadingVideos] = useState(false);

  // Fetch Videos from YouTube Channel via RSS (RSS2JSON)
  useEffect(() => {
    if (!YOUTUBE_CHANNEL_ID) return;

    const fetchChannelVideos = async () => {
      setLoadingVideos(true);
      try {
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
        const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
        
        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.status === 'ok' && data.items) {
          const mappedVideos = data.items.map((item: any, index: number) => {
            // Extract video ID from link or guid
            // Format link: https://www.youtube.com/watch?v=VIDEO_ID
            // Format guid: yt:video:VIDEO_ID
            let vId = '';
            if (item.guid && item.guid.includes('video:')) {
                vId = item.guid.split('video:')[1];
            } else if (item.link && item.link.includes('v=')) {
                vId = item.link.split('v=')[1];
            }

            return {
              id: `rss-${index}`,
              title: item.title,
              videoId: vId,
              thumbnail: `https://i.ytimg.com/vi/${vId}/mqdefault.jpg`
            };
          }).filter((v: any) => v.videoId); // Filter valid IDs

          if (mappedVideos.length > 0) {
            setTutorialVideos(mappedVideos);
          }
        }
      } catch (error) {
        console.error("Failed to fetch YouTube feed:", error);
      } finally {
        setLoadingVideos(false);
      }
    };

    if (activeTab === 'tutorials') {
        fetchChannelVideos();
    }
  }, [activeTab]);

  const openVideoWindow = async (video: typeof MANUAL_VIDEOS[0]) => {
    try {
        // Create a unique label for the window
        const label = `video-${video.videoId}`;
        
        // Check if window already exists
        // Note: Tauri v1 WebviewWindow doesn't have static get, we just try to create.
        // If label exists, it might focus or fail. 
        
        const webview = new WebviewWindow(label, {
            url: `index.html?video_id=${video.videoId}&title=${encodeURIComponent(video.title)}`,
            title: video.title,
            width: 1024,
            height: 600,
            resizable: true,
            decorations: true,
            alwaysOnTop: false // User can toggle if they want, but standard window is better
        });

        webview.once('tauri://created', function () {
            // window created
        });
        
        webview.once('tauri://error', function (e) {
            // If window already exists, we might get error, so we can try to focus it?
            // Usually we just ignore duplicate creation errors or handle gracefully
            console.log('Window creation error (might already exist):', e);
        });

    } catch (e) {
        console.error('Failed to open video window', e);
    }
  };

  const content = {
    en: {
      title: "Metabayn Studio User Guide",
      tabs: {
        settings: "Settings & Config",
        usage: "How to Use",
        filters: "Selection Filters",
        faq: "FAQ & Tips",
        tutorials: "Video Tutorials"
      },
      tutorials: {
        title: "Video Tutorials",
        desc: "Watch step-by-step guides on how to use Metabayn Studio.",
      },
      settings: {
        title: "Configuration Settings",
        desc: "Detailed explanation of each setting in the dashboard.",
        items: [
          { title: "Input Folder", desc: "Select the folder containing your source images/videos to be processed." },
          { title: "Output Folder", desc: "Select the destination folder where processed files (and CSVs) will be saved." },
          { title: "AI Provider", desc: "Choose the AI service backend (OpenAI, Gemini, or Groq). Each has different strengths and pricing." },
          { title: "Model", desc: "Select the specific AI model version (e.g., GPT-4o, Gemini 1.5 Pro). Newer models are usually smarter but may cost more." },
          { title: "API Key", desc: "Toggle 'On' to use your own personal API Key. Toggle 'Off' to use the built-in shared pool (requires app balance)." },
          { title: "Threads", desc: "Number of concurrent images to process at once. Higher values are faster but use more CPU/RAM and internet bandwidth. Default: 4-8." },
          { title: "Retry", desc: "Number of times to automatically retry processing an image if the AI fails or returns an error." },
          { title: "Title Min/Max", desc: "Set the minimum and maximum number of WORDS allowed for the generated title." },
          { title: "Description Min/Max", desc: "Set the minimum and maximum number of CHARACTERS allowed for the generated description." },
          { title: "Keywords Min/Max", desc: "Set the minimum and maximum number of keywords/tags to generate." },
          { title: "Image Selection", desc: "Enable/Disable the AI filtering system. If On, images will be checked against your filter criteria (Human, Animal, Text, etc.) before or after generation." },
          { title: "Generate CSV", desc: "If On, a CSV file (Metabayn/Shutterstock format) will be created/updated in the output folder containing the metadata. If Off, metadata is only embedded into the image files." },
          { title: "Rename File", desc: "Automatically rename the file after metadata is written. Options: 'Title' (from AI title), 'Date/Time' (DDMMYY-HHMMSS), or 'Custom' (user defined)." },
          { title: "Banned Words", desc: "A comma-separated list of words that should NEVER appear in the generated titles, descriptions, or keywords." }
        ]
      },
      usage: {
        title: "Application Workflow",
        desc: "Step-by-step guide to generating metadata.",
        items: [
          { title: "1. Preparation", desc: "Ensure your images are ready in a folder. Organize them if needed." },
          { title: "2. Configuration", desc: "Set your Input and Output folders. Adjust the 'Settings' (Model, Threads, Limits) according to your needs." },
          { title: "3. Start Processing", desc: "Click the 'Play' (▶) button to begin. The application will scan the input folder and start processing images." },
          { title: "4. Monitoring", desc: "Watch the log panel on the right. Green logs indicate success, Red logs indicate failures or rejections (by filters)." },
          { title: "5. Pausing/Stopping", desc: "Click 'Pause' (||) to temporarily halt. Click 'Stop' (■) to cancel the remaining batch." },
          { title: "6. Results", desc: "Processed images are saved to the Output folder with metadata embedded (IPTC/XMP). If CSV is enabled, check the CSV file in the same folder." },
          { title: "7. Manual CSV Generation", desc: "Generate CSVs from existing folders without re-processing. Click the 'CSV' icon in the footer, select your folder, and check the logs for the result." },
          { title: "8. Duplicate Detection", desc: "Find and remove duplicate files. Click the 'DUP' icon in the footer. 'Auto Delete' removes exact matches immediately. 'Threshold' controls similarity sensitivity (lower = stricter). Similar files are moved to '_DUPLICATE_REVIEW' for your inspection." },
          { title: "9. AI Media Clustering", desc: "Group images and videos by visual similarity using AI (CLIP Model). Click the 'AI' icon (network node) in the footer. Select a folder, and the AI will analyze content and move similar files into grouped folders (Group_001, etc.). Useful for organizing large datasets." }
        ]
      },
      filters: {
        title: "Selection Filters Guide",
        desc: "Understanding how to filter unwanted images automatically.",
        subsections: [
          {
            header: "Human Filters",
            items: [
              { title: "Full Body (Perfect Face)", desc: "Rejects images where a full human body is clearly visible, including a distinct face." },
              { title: "No Head Visible", desc: "Rejects images where a human body is present but the head is cut off, hidden, or missing." },
              { title: "Partial Body (Perfect)", desc: "Rejects images showing only parts of a human body (like hands, legs, or torso) that look realistic and perfect." },
              { title: "Partial Body (Defect)", desc: "Rejects images showing human body parts that appear deformed, distorted, or unnatural." },
              { title: "Back View", desc: "Rejects images where a human subject is facing away from the camera." },
              { title: "Unclear/Hybrid/Alien", desc: "Rejects subjects that look human-like but are distorted, hybrid creatures, or alien-like." },
              { title: "Face Only", desc: "Rejects images that contain only a human face (close-up/portrait) without a significant body portion." },
              { title: "Nudity/NSFW", desc: "Strictly filters out any images containing nudity, sexual content, or inappropriate material." }
            ]
          },
          {
            header: "Animal Filters",
            items: [
               { title: "Full Body (Perfect)", desc: "Rejects images showing a complete animal body that looks realistic and perfect." },
               { title: "No Head Visible", desc: "Rejects images where an animal body is visible but the head is missing or cut off." },
               { title: "Partial Body (Perfect)", desc: "Rejects images containing only parts of an animal (like paws, tails, or torso) that look realistic." },
               { title: "Partial Body (Defect)", desc: "Rejects images with deformed or distorted animal body parts." },
               { title: "Back View", desc: "Rejects images where an animal is seen from behind." },
               { title: "Unclear/Hybrid/Alien", desc: "Rejects creatures that look like animals but are distorted, unrecognizable, or hybrid monsters." },
               { title: "Face Only", desc: "Rejects images that show only an animal's face (close-up) without the rest of the body." },
               { title: "Mating/Genitals", desc: "Filters out images depicting animals mating or showing visible genitals." }
            ]
          },
          {
            header: "Text Filters",
            items: [
              { title: "Gibberish/Meaningless", desc: "Rejects text that has no readable meaning, such as random letters or AI-generated squiggles." },
              { title: "Non-English Text", desc: "Rejects any text that is detected as a valid language other than English." },
              { title: "Irrelevant Meaning", desc: "Rejects text that is readable but has no relevance to the visual content of the image." },
              { title: "Relevant Meaning", desc: "Strict Mode: Rejects ALL detected text, even if it makes sense or is relevant." }
            ]
          },
          {
            header: "Other Filters",
            items: [
              { title: "Deformed Object", desc: "Rejects images containing objects that are physically impossible, broken, or heavily distorted." },
              { title: "Unrecognizable Subject", desc: "Rejects images where the main subject is too blurry, abstract, or cannot be clearly identified." },
              { title: "Brand Logo", desc: "Rejects images containing visible commercial brand logos, icons, or trademarks." },
              { title: "Famous Trademark", desc: "Rejects images with clearly visible famous logos/IPs (Disney, Apple, Ferrari). Ignores generic objects/cars." },
              { title: "Watermark", desc: "Rejects images that have visible watermarks, stock photo stamps, or copyright text overlays." },
              { title: "Duplicate Similarity", desc: "Rejects images that are visually almost identical to others in the batch." },
              { title: "Selection Order", desc: "'Before Generate' filters existing images. 'After Generate' filters the AI-generated output." },
              { title: "Dup dist (Duplicate Distance)", desc: "Controls duplicate sensitivity. Lower values (0-5) are stricter. Higher values match loosely similar images." }
            ]
          }
        ]
      },
      faq: {
        title: "Tips & FAQ",
        desc: "Common questions and best practices.",
        items: [
           { title: "Why is my CPU usage high?", desc: "High 'Threads' count or processing large images causes high CPU load. Try reducing Threads to 2-4." },
           { title: "Images are being rejected incorrectly", desc: "Check your 'Image Selection' settings. Some filters might be too strict. Try disabling specific sub-filters." },
           { title: "Metadata is missing in some apps", desc: "We embed standard IPTC/XMP metadata. Some OS viewers (like Windows Explorer) might not show all fields, but stock agencies (Adobe, Shutterstock) will read them." }
        ]
      }
    },
    id: {
      title: "Panduan Pengguna Metabayn",
      tabs: {
        settings: "Pengaturan",
        usage: "Cara Penggunaan",
        filters: "Filter Seleksi",
        faq: "Tips & FAQ",
        tutorials: "Video Tutorial"
      },
      tutorials: {
        title: "Video Tutorial",
        desc: "Tonton panduan langkah demi langkah cara menggunakan Metabayn Studio.",
      },
      settings: {
        title: "Konfigurasi Pengaturan",
        desc: "Penjelasan detail setiap pengaturan di dashboard.",
        items: [
          { title: "Input Folder", desc: "Pilih folder yang berisi gambar/video sumber yang akan diproses." },
          { title: "Output Folder", desc: "Pilih folder tujuan tempat menyimpan file hasil (dan CSV)." },
          { title: "AI Provider", desc: "Pilih penyedia layanan AI (OpenAI, Gemini, atau Groq). Masing-masing memiliki kelebihan dan harga berbeda." },
          { title: "Model", desc: "Pilih versi model AI (misal: GPT-4o, Gemini 1.5 Pro). Model baru biasanya lebih pintar tetapi mungkin lebih mahal." },
          { title: "API Key", desc: "Aktifkan (On) untuk menggunakan API Key pribadi Anda. Matikan (Off) untuk menggunakan saldo aplikasi (sistem shared)." },
          { title: "Threads", desc: "Jumlah proses bersamaan. Nilai lebih tinggi lebih cepat tetapi menggunakan lebih banyak CPU/RAM dan internet. Default: 4-8." },
          { title: "Retry", desc: "Jumlah percobaan ulang otomatis jika AI gagal atau error." },
          { title: "Title Min/Max", desc: "Batas minimum dan maksimum jumlah KATA untuk judul." },
          { title: "Description Min/Max", desc: "Batas minimum dan maksimum jumlah KARAKTER untuk deskripsi." },
          { title: "Keywords Min/Max", desc: "Batas minimum dan maksimum jumlah kata kunci/tags." },
          { title: "Image Selection", desc: "Aktifkan/Matikan sistem filter AI. Jika On, gambar akan diperiksa sesuai kriteria filter (Manusia, Hewan, Teks, dll)." },
          { title: "Generate CSV", desc: "Jika On, file CSV (format Metabayn/Shutterstock) akan dibuat di folder output. Jika Off, metadata hanya disematkan ke file gambar." },
          { title: "Rename File", desc: "Otomatis mengganti nama file setelah metadata tertulis. Opsi: 'Title' (dari judul AI), 'Date/Time' (DDMMYY-HHMMSS), atau 'Custom' (definisi pengguna)." },
          { title: "Banned Words", desc: "Daftar kata yang dilarang (dipisahkan koma). Kata-kata ini TIDAK akan muncul di judul, deskripsi, atau keywords." }
        ]
      },
      usage: {
        title: "Alur Kerja Aplikasi",
        desc: "Langkah demi langkah untuk menghasilkan metadata.",
        items: [
          { title: "1. Persiapan", desc: "Siapkan gambar Anda dalam satu folder. Rapikan jika perlu." },
          { title: "2. Konfigurasi", desc: "Atur Folder Input dan Output. Sesuaikan 'Pengaturan' (Model, Threads, Batasan) sesuai kebutuhan." },
          { title: "3. Mulai Proses", desc: "Klik tombol 'Play' (▶) untuk memulai. Aplikasi akan memindai folder input dan memproses gambar." },
          { title: "4. Monitoring", desc: "Pantau panel log di sebelah kanan. Log hijau berarti sukses, Merah berarti gagal atau ditolak (oleh filter)." },
          { title: "5. Jeda/Berhenti", desc: "Klik 'Pause' (||) untuk menjeda sementara. Klik 'Stop' (■) untuk membatalkan sisa antrian." },
          { title: "6. Hasil", desc: "Gambar yang diproses disimpan di Folder Output dengan metadata tertanam. Cek juga file CSV jika fitur tersebut diaktifkan." },
          { title: "7. CSV Manual", desc: "Anda juga bisa membuat CSV secara manual dari folder yang sudah ada tanpa memproses ulang gambar. Klik ikon 'CSV' di bagian bawah (footer), pilih folder, dan tunggu konfirmasi di log." },
          { title: "8. Deteksi Duplikat", desc: "Temukan dan hapus file duplikat. Klik ikon 'DUP' di footer. 'Auto Delete' menghapus file identik secara langsung. 'Threshold' mengatur sensitivitas kemiripan (makin kecil = makin ketat). File yang mirip akan dipindahkan ke folder '_DUPLICATE_REVIEW' untuk Anda periksa." },
          { title: "9. AI Media Clustering", desc: "Kelompokkan gambar dan video berdasarkan kemiripan visual menggunakan AI (Model CLIP). Klik ikon 'AI' (simpul jaringan) di footer. Pilih folder, dan AI akan menganalisis konten serta memindahkan file yang mirip ke dalam folder grup (Group_001, dll). Sangat berguna untuk merapikan dataset besar." }
        ]
      },
      filters: {
        title: "Panduan Filter Seleksi",
        desc: "Memahami cara memfilter gambar yang tidak diinginkan.",
        subsections: [
          {
            header: "Filter Manusia",
            items: [
              { title: "Full Body (Perfect Face)", desc: "Menolak gambar jika terlihat seluruh tubuh manusia dengan wajah yang jelas." },
              { title: "No Head Visible", desc: "Menolak gambar jika tubuh manusia terlihat tetapi kepalanya terpotong atau hilang." },
              { title: "Partial Body (Perfect)", desc: "Menolak gambar yang hanya menampilkan sebagian anggota tubuh yang terlihat realistis dan sempurna." },
              { title: "Partial Body (Defect)", desc: "Menolak gambar jika terlihat anggota tubuh yang cacat, terdistorsi, atau tidak wajar." },
              { title: "Back View", desc: "Menolak gambar jika subjek manusia terlihat membelakangi kamera." },
              { title: "Unclear/Hybrid/Alien", desc: "Menolak subjek yang menyerupai manusia tetapi terdistorsi atau seperti alien." },
              { title: "Face Only", desc: "Menolak gambar jika hanya wajah manusia yang terlihat (close-up) tanpa tubuh." },
              { title: "Nudity/NSFW", desc: "Secara ketat memfilter gambar yang mengandung ketelanjangan atau konten seksual." }
            ]
          },
          {
            header: "Filter Hewan",
            items: [
               { title: "Full Body (Perfect)", desc: "Menolak gambar jika seluruh tubuh hewan terlihat jelas dan tampak sempurna." },
               { title: "No Head Visible", desc: "Menolak gambar jika tubuh hewan terlihat tetapi kepalanya hilang." },
               { title: "Partial Body (Perfect)", desc: "Menolak gambar yang hanya menampilkan sebagian tubuh hewan yang terlihat realistis." },
               { title: "Partial Body (Defect)", desc: "Menolak gambar dengan bagian tubuh hewan yang cacat atau terdistorsi." },
               { title: "Back View", desc: "Menolak gambar jika hewan terlihat dari belakang." },
               { title: "Unclear/Hybrid/Alien", desc: "Menolak makhluk yang terlihat seperti hewan tetapi terdistorsi atau monster hibrida." },
               { title: "Face Only", desc: "Menolak gambar jika hanya wajah hewan yang terlihat tanpa tubuh." },
               { title: "Mating/Genitals", desc: "Memfilter gambar yang menggambarkan hewan kawin atau alat kelamin." }
            ]
          },
          {
            header: "Filter Teks",
            items: [
              { title: "Gibberish/Meaningless", desc: "Menolak teks yang tidak memiliki arti, huruf acak atau coretan AI." },
              { title: "Non-English Text", desc: "Menolak teks bahasa selain Inggris (misal: Mandarin, Arab)." },
              { title: "Irrelevant Meaning", desc: "Menolak teks yang terbaca tapi tidak relevan dengan gambar." },
              { title: "Relevant Meaning", desc: "Mode Ketat: Menolak SEMUA teks yang terdeteksi." }
            ]
          },
          {
            header: "Filter Lainnya",
            items: [
              { title: "Deformed Object", desc: "Menolak objek yang tidak mungkin secara fisik, rusak, atau terdistorsi." },
              { title: "Unrecognizable Subject", desc: "Menolak gambar subjek buram, abstrak, atau tidak jelas." },
              { title: "Brand Logo", desc: "Menolak gambar yang mengandung logo merek atau ikon komersial." },
              { title: "Famous Trademark", desc: "Menolak gambar dengan logo/IP terkenal yang jelas (Disney, Apple, Ferrari). Mengabaikan objek generik." },
              { title: "Watermark", desc: "Menolak gambar yang memiliki tanda air atau teks hak cipta." },
              { title: "Duplicate Similarity", desc: "Menolak gambar yang hampir identik dengan yang lain dalam satu batch." },
              { title: "Selection Order", desc: "'Before Generate' memfilter sebelum AI. 'After Generate' memfilter hasil output AI." },
              { title: "Dup dist (Duplicate Distance)", desc: "Sensitivitas duplikat. Nilai rendah (0-5) lebih ketat. Nilai tinggi lebih longgar." }
            ]
          }
        ]
      },
      faq: {
        title: "Tips & FAQ",
        desc: "Pertanyaan umum dan praktik terbaik.",
        items: [
           { title: "Mengapa penggunaan CPU tinggi?", desc: "Jumlah 'Threads' tinggi atau gambar besar menyebabkan beban CPU. Coba kurangi Threads ke 2-4." },
           { title: "Gambar ditolak secara salah?", desc: "Periksa pengaturan 'Image Selection'. Beberapa filter mungkin terlalu ketat. Coba matikan sub-filter tertentu." },
           { title: "Metadata hilang di aplikasi lain?", desc: "Kami menyematkan metadata IPTC/XMP standar. Beberapa viewer OS (seperti Windows Explorer) mungkin tidak menampilkan semua field, tapi agensi stok (Shutterstock, Adobe) akan membacanya." }
        ]
      }
    }
  };

  const current = content[lang];
  const tabs = [
    { id: 'settings', label: current.tabs.settings },
    { id: 'usage', label: current.tabs.usage },
    { id: 'filters', label: current.tabs.filters },
    { id: 'faq', label: current.tabs.faq },
    { id: 'tutorials', label: current.tabs.tutorials },
  ];

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Segoe UI, sans-serif'
    }} onClick={onClose}>
      <div style={{
        background: '#1e1e1e', width: '700px', maxHeight: '85vh',
        borderRadius: '12px', border: '1px solid #333',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 25px 60px rgba(0,0,0,0.6)'
      }} onClick={e => e.stopPropagation()}>
        
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #333',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#252525'
        }}>
          <div style={{display:'flex', alignItems:'center', gap: 12}}>
            {/* Language Switcher */}
            <div style={{display:'flex', background: '#333', borderRadius: 6, padding: 3}}>
                <button 
                    onClick={() => setLang('en')}
                    style={{
                        background: lang === 'en' ? '#4caf50' : 'transparent',
                        color: lang === 'en' ? '#fff' : '#888',
                        border: 'none', borderRadius: 4, padding: '4px 8px',
                        cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', transition: 'all 0.2s'
                    }}
                    title="English"
                >
                    EN
                </button>
                <button 
                    onClick={() => setLang('id')}
                    style={{
                        background: lang === 'id' ? '#4caf50' : 'transparent',
                        color: lang === 'id' ? '#fff' : '#888',
                        border: 'none', borderRadius: 4, padding: '4px 8px',
                        cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', transition: 'all 0.2s'
                    }}
                    title="Bahasa Indonesia"
                >
                    ID
                </button>
            </div>
            <h3 style={{margin: 0, fontSize: '16px', color: '#fff', fontWeight: 600}}>{current.title}</h3>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '20px', padding: 4
          }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{display: 'flex', borderBottom: '1px solid #333', background: '#222'}}>
          {tabs.map(tab => (
            <div key={tab.id} 
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: '12px', textAlign: 'center', cursor: 'pointer',
                fontSize: '13px', fontWeight: activeTab === tab.id ? '600' : 'normal',
                color: activeTab === tab.id ? '#4caf50' : '#888',
                borderBottom: activeTab === tab.id ? '2px solid #4caf50' : '2px solid transparent',
                background: activeTab === tab.id ? '#2a2a2a' : 'transparent',
                transition: 'all 0.2s'
              }}
            >
              {tab.label}
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={{padding: '20px', overflowY: 'auto', flex: 1, color: '#ccc', fontSize: '13px', lineHeight: '1.6'}}>
          
          {/* Settings & Usage Tab */}
          {(activeTab === 'settings' || activeTab === 'usage' || activeTab === 'faq') && (
            <div>
              <div style={{
                  marginBottom: '15px', padding: '12px', background: '#2a2a2a', 
                  borderRadius: '6px', borderLeft: '4px solid #4caf50'
              }}>
                <strong style={{fontSize: '14px', color: '#fff'}}>{current[activeTab].title}</strong>
                <p style={{margin: '4px 0 0', opacity: 0.8, fontSize: '12px'}}>{current[activeTab].desc}</p>
              </div>
              <ul style={{listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '10px'}}>
                {current[activeTab].items.map((item: any, idx: number) => (
                    <HelpItem key={idx} title={item.title} desc={item.desc} />
                ))}
              </ul>
            </div>
          )}

          {/* Filters Tab (Structured differently) */}
          {activeTab === 'filters' && (
             <div>
                <div style={{
                  marginBottom: '15px', padding: '12px', background: '#2a2a2a', 
                  borderRadius: '6px', borderLeft: '4px solid #2196f3'
                }}>
                  <strong style={{fontSize: '14px', color: '#fff'}}>{current.filters.title}</strong>
                  <p style={{margin: '4px 0 0', opacity: 0.8, fontSize: '12px'}}>{current.filters.desc}</p>
                </div>
                
                {current.filters.subsections.map((section, idx) => (
                  <div key={idx} style={{marginBottom: 20}}>
                    <h4 style={{margin: '0 0 10px 0', color: '#fff', borderBottom: '1px solid #333', paddingBottom: 5}}>{section.header}</h4>
                    <ul style={{listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '8px'}}>
                      {section.items.map((item, i) => (
                          <HelpItem key={i} title={item.title} desc={item.desc} />
                      ))}
                    </ul>
                  </div>
                ))}
             </div>
          )}

          {/* Tutorials Tab */}
          {activeTab === 'tutorials' && (
             <div>
                <div style={{
                  marginBottom: '15px', padding: '12px', background: '#2a2a2a', 
                  borderRadius: '6px', borderLeft: '4px solid #e91e63'
                }}>
                  <strong style={{fontSize: '14px', color: '#fff'}}>{current.tutorials.title}</strong>
                  <p style={{margin: '4px 0 0', opacity: 0.8, fontSize: '12px'}}>{current.tutorials.desc}</p>
                </div>
                
                <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                    {TUTORIAL_VIDEOS.map(video => (
                        <div key={video.id} 
                            onClick={() => {
                                const label = `video-${video.id}`;
                                const existing = WebviewWindow.getByLabel(label);
                                if (existing) {
                                    existing.setFocus();
                                } else {
                                    new WebviewWindow(label, {
                                        url: `index.html?video_id=${video.videoId}&title=${encodeURIComponent(video.title)}`,
                                        title: video.title,
                                        width: 640,
                                        height: 360,
                                        alwaysOnTop: true,
                                        resizable: true,
                                        focus: true
                                    });
                                }
                            }}
                            style={{
                                background: '#252525', borderRadius: '8px', overflow: 'hidden',
                                cursor: 'pointer', transition: 'transform 0.2s', border: '1px solid #333',
                                display: 'flex', flexDirection: 'row', height: '90px'
                            }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                            onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                        >
                            {/* Thumbnail */}
                            <div style={{width: '160px', position: 'relative', background: '#000', flexShrink: 0}}>
                                <img 
                                    src={`https://img.youtube.com/vi/${video.videoId}/hqdefault.jpg`} 
                                    alt={video.title}
                                    style={{width: '100%', height: '100%', objectFit: 'cover', opacity: 0.8}}
                                />
                                <div style={{
                                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                                    width: '32px', height: '32px', background: 'rgba(0,0,0,0.7)', borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff'
                                }}>
                                    <span style={{color: '#fff', fontSize: '14px', marginLeft: '2px'}}>▶</span>
                                </div>
                            </div>
                            {/* Title */}
                            <div style={{padding: '12px', flex: 1, display: 'flex', alignItems: 'center'}}>
                                <div style={{fontSize: '14px', color: '#fff', fontWeight: '500', lineHeight: '1.4'}}>
                                    {video.title}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
                <div style={{marginTop: 20, fontSize: '11px', color: '#666', fontStyle: 'italic', textAlign: 'center'}}>
                    * Click video to open independent player window / Klik video untuk membuka jendela player terpisah.
                </div>
             </div>
          )}

        </div>
      </div>
    </div>
  );
}

const HelpItem = ({title, desc}: {title: string, desc: string}) => (
  <li style={{background: '#252525', padding: '10px 12px', borderRadius: '6px', border: '1px solid #333'}}>
    <div style={{color: '#fff', fontWeight: 'bold', marginBottom: '4px', fontSize: '13px'}}>{title}</div>
    <div style={{color: '#aaa', fontSize: '12px'}}>{desc}</div>
  </li>
)
