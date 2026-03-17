# InstaApp Proje Özeti ve Geliştirici Yönergeleri (Agent Yönergeleri)

## Proje Hakkında
InstaApp, Instagram (Meta API) ile entegre çalışan; Süper Admin ve Editör rolündeki kullanıcıların Meta içeriklerini paylaşabildiği, yönetebildiği ve bu paylaşımlar üzerinden kazanç elde edebildiği Node.js tabanlı özel bir otomasyon ve içerik yönetim panelidir.

Aynı zamanda içerisinde bir **To-Do (Görev Yönetimi)** sistemi ve detaylı bir **Cüzdan / Bakiye Takip Sistemi** barındırır. Arka planda (`worker.js`) çalışan görevler, paylaşılan içeriklerin Meta üzerindeki beğeni sayılarını takip ederek koşulları sağlayan üyelere bonus ödemesi yapar, silinen içeriklerin bakiye kesintilerini (`DELETION_DEDUCTION`) idare eder.

## Temel Teknolojiler
- **Backend:** Node.js, Express.js (v5)
- **Veritabanı:** SQLite3 (`data/app.db`)
- **Kimlik Doğrulama:** JWT (JSON Web Tokens), `bcryptjs`
- **Dosya İşlemleri:** `multer` (Uploads), `jimp` (Görsel optimizasyonu/çevrimleri), `catbox.moe / uguu.se` API'leri üzerinden medya proxyleme.
- **Harici Katman:** Meta Graph API (Instagram Hesap Paylaşımları ve Takibi)

## Proje Klasör ve Dosya Yapısı
- **`server.js`**: Uygulamanın ana API ve Controller yapısı. Express server'ı, Media serving (`/media`), Authentication endpointleri, Admin endpointleri (User CRUD, Loglar, Ayarlar vb.) ve Meta paylaşım (`/api/share`) entegrasyonu bu dosyada bulunur.
- **`database.js`**: SQLite veritabanı bağlantısı ve tablo oluşturma (migration) işlemlerini, DB şemasını içerir.
- **`auth.js`**: Giriş (Login), Kayıt (Süper Adminler için kullanıcı ekleme / `register`), Token doğrulama (`verifyToken`), Middleware (`isSuperAdmin`), Şifre yönetimi ve Log kaydetme (`logAction`) yardımcılarını tutar.
- **`meta_api.js`**: Meta API (`graph.facebook.com`) ile iletişim kuran proxy modülü (Container açma, Video bekleme vb. alt yapılarda kullanılır).
- **`worker.js`**: Arka planda periyodik olarak çalıştırılmak üzere tasarlanan, "Beğeni Bonusları (LIKE_BONUS)" sağlayan veya silinmiş (does not exist) içeriklerin ücret iadelerini/kesintilerini (reversed) güncelleyen cron logici.
- **`ui/`**: Frontend klasörü. `index.html`, `login.html`, `haber_gonder.html` gibi sayfalar statik olarak bu dizinden servis edilir.
- **`data/`**: `.db` (SQLite veritabanı) ve uygulamanın Instagram yedekleri / medyasının (`instagram_activity`) tutulabildiği veriler klasörü.

## Veritabanı Tabloları ve İlişkileri (Şema)
- **`users`**: Süper Admin veya Editör rolündeki kullanıcıların detayları (`iban`, `avatar_url`, `earnings_balance`).
- **`logs`**: Kullanıcıların sistem üzerinde gerçekleştirdiği tüm denetimleri kaydeden günlükler (`action`, `details`, `ip_address`, `status`).
- **`settings`**: Key-value store mantığıyla çalışan uygulama ayarları (örn. `fee_per_post`, `bonus_per_100_likes`, API Token'ları).
- **`wallet_transactions`**: Cüzdan işlem geçmişi (`type`: EARNING, WITHDRAWAL, LIKE_BONUS, DELETION_DEDUCTION). Beğeni kontrol durumunu (`check_status`) tutar.
- **`payment_requests`**: Editörlerin verdikleri para çekme (`pending` / `completed`) talepleri.
- **`submitted_news`**: Genel arayüzden (Panel dışından) gönderilen veya admin paneline kaydedilen Haber / Submit form içerikleri.
- **`tasks`**: Sistemin To-Do listesi içerikleri (`status`: pending, in_progress, completed). `assigned_by` ve `assigned_to` ile kullanıcılara bağlanır.

## Temel İş Akışları (Workflows)
1. **İçerik Paylaşımı (Share Logic):**
   - Panelden resim/video seçimi yapılır (`/api/share`). 
   - Meta Graph API üzerinden `container` (Creation ID) oluşturulur, gerekirse video sürecinin işlenmesi (`waitForVideo`) beklenir.
   - Yayınlandığında (Publish işlemi) Editör rolündeki kullanıcının cüzdan bakiyesine `fee_per_post` değerinde ("EARNING") ücret aktarılır ve loglanır.
2. **Cron İşleri (Worker Logic):**
   - Bonus Takibi: `worker.js` çalıştırıldığında (son 30 güne ait pending olan) paylaşılan postId üzerinden `like_count` getirilir. 100 beğeniyi geçiyorsa `LIKE_BONUS` işlemi cüzdana eklenip durumu `verified_bonus_paid` yapılır.
   - Silinen Post Kontrolü: Aynı worker API hatası döndüren içerikleri "silindi" kabul edip bakiyeden kesinti (Reverse transaction) uygular.

---

## Agent (LLM) Yönergeleri ve Geliştirme Standartları (Guidelines)
Bu proje üzerinde geliştirme yapacak, yeni özellik ekleyecek veya debug yapacak bir Agent şu kurallara kesinlikle uymalıdır:

1. **Güvenlik ve Yetkilendirme Middleware'leri:** 
   - Tüm özel/kapalı API rotalarında (`/api/admin/...`, `/api/profile/...`, `/api/tasks/...`) muhakkak `verifyToken` kullanılmalıdır. 
   - Admin dışındaki yetkileri aşacak / kısıtlayacak sayfa/işlemlerde muhakkak `verifyToken` ile birlikte `isSuperAdmin` eklenmelidir.
   
2. **Denetim Günlükleri (Audit Log):**
   - Kullanıcının şifre, email, ayar değiştirmesi, başarılı login durumları, share başlatma/hata ve silme işlemleri gibi önemli adımlarda `auth.js` modülünde yer alan `logAction` (örn: `logAction(req.user.id, 'ACTION_NAME', 'Details', req.ip, 'SUCCESS')`) fonksiyonunu çağırmalısınız.

3. **Veritabanı (SQLite) Operasyonları:** 
   - Node SQLite (`sqlite3` paketinin) modüllerinin kısıtlamalarını hesaba katarak `.run()` gibi asenkron call'larda `this.changes` veya `this.lastID`'ye erişmek için fonksiyonları Arrow Function (`() => {}`) DEĞİL; standart işlev olarak (`function (err) { }`) yazmalısınız. (Lexical `this` bağlamından dolayı).
   - İş katmanında ("business logic") birden fazla insert/update yapılacağında `.serialize()` sarmalamasını (`db.serialize(...)`) unutmayın.

4. **Meta API Esneklik ve Exception Handling:**
   - Olası API down olma, 100/33 gibi Facebook Graph API native hata senaryolarını mutlaka Log tablolarına yazdıran JSON Parsing yaklaşımlarını (`try-catch` bloklarını) kodunuzdan ayırmayın. Meta entegrasyonu projenin core (çekirdek) kısmıdır.

5. **Arayüz (UI) Katmanı:**
   - Statik `/ui` arayüzü (Backend tarafına yük bindirmemek için) Express üzerinden static servis edilmektedir. API'den veriler genellikle React vb. bağımlılığı hissettirmeden Fetch AJAX metodolojisi ile frontend'e basılmaktadır. Eklenecek her yeni UI komponenti mevcut HTML/JS dosyalarıyla (Tailwind/Tailadmin esintili) entegre edilmelidir.
