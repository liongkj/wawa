import { useEffect, useRef, useState } from 'react';
import './styles.css';

const content = {
  en: {
    previewNotice: 'Test preview: signups are local and emails are simulated.',
    language: 'Language',
    home: 'Wawa home',
    docs: 'Docs',
    github: 'GitHub',
    preview: 'Open-source preview',
    title: 'Keep track of requests in WhatsApp',
    intro:
      'Find the requests, questions and follow-ups in the chats you choose. Each item links back to the conversation.',
    install: 'Self-host Wawa',
    managed: 'Managed hosting',
    fine: 'You maintain your own server. Managed hosting is not available yet.',
    listen: 'Play the story with sound',
    stop: 'Stop the story',
    storyTitle: 'A familiar conversation',
    storyHint: 'A short, illustrated example',
    audioError: 'Audio could not play. Try again or read the examples below.',
    story: [
      { who: 'Client', line: 'Did you send the revised quote?', audio: '/audio/line-1.mp3' },
      {
        who: 'You',
        line: 'I know it is in WhatsApp. Which chat was it in?',
        audio: '/audio/line-2.mp3',
      },
      {
        who: 'You',
        line: 'Seventeen chats! That is not a filing system. That is a scavenger hunt!',
        audio: '/audio/line-3.mp3',
      },
      {
        who: 'You',
        line: 'There it is. Wawa kept the request with the original message.',
        audio: '/audio/line-4.mp3',
      },
    ],
    familiar: 'Sound familiar?',
    casesTitle: 'Requests get buried in every kind of work',
    casesIntro: 'A few examples of the moments Wawa can help you keep in view.',
    examples: [
      {
        category: 'Renovation · Client chat',
        question: 'Buried in the scroll',
        message: 'Oh, and can you quote the back gate too? Same design as the front.',
        item: 'Quote the back gate',
        kind: 'Action',
      },
      {
        category: 'Home bakery · New customer',
        question: 'The question you meant to answer',
        message: 'Can you make 40 boxes for Saturday? I need to know by Wednesday.',
        item: 'Can you make 40 boxes for Saturday?',
        kind: 'Question',
      },
      {
        category: 'Rentals · Tenant chat',
        question: 'A problem to come back to',
        message: 'The kitchen sink is leaking again. Can someone take a look?',
        item: 'Check the kitchen sink leak',
        kind: 'Task',
      },
      {
        category: 'Freelance design · Client',
        question: 'Waiting on someone else',
        message: 'Could you send the logo as an SVG? — Sure, tonight!',
        item: 'Logo SVG from client',
        kind: 'Waiting for',
      },
      {
        category: 'Retail · Supplier chat',
        question: 'They said something about delivery',
        message: 'From next month, delivery is free above 50 cartons.',
        item: 'delivery',
        kind: 'Search',
      },
    ],
    exampleMessage: 'Example message',
    linked: 'Linked to the original message',
    illustrative: 'Illustrative examples',
    previous: 'Previous example',
    next: 'Next example',
    pause: 'Pause',
    play: 'Play',
    privacy:
      'Wawa uses an unofficial WhatsApp connection; accounts may be restricted. Selected messages and images are sent to your configured AI provider.',
    workspace: 'Your workspace',
    workspaceTitle: 'Your workspace, on your server',
    workspaceText:
      'Review tasks, questions and follow-ups together. Open the source message when you need the context.',
    screenshot: 'Wawa workspace overview showing tasks, actions, questions and reminders',
    how: 'How it works',
    howTitle: 'How Wawa works',
    steps: [
      ['Choose your chats', 'Link WhatsApp and choose the conversations you want Wawa to follow.'],
      [
        'See what needs attention',
        'Find requests, questions and reminders with their source context.',
      ],
      ['Run your workspace', 'Host Wawa on your own server and choose your model connection.'],
    ],
    waitTitle: 'Want us to host it?',
    waitText:
      'Managed Wawa is not available yet. Join the waitlist for updates if it becomes available.',
    email: 'Email address',
    emailPlaceholder: 'you@example.com',
    join: 'Join the waitlist',
    joining: 'Joining…',
    consent: 'By joining, you agree to receive email updates about managed Wawa.',
    success: 'You’re on the waitlist. We’ve requested a confirmation email.',
    saved: 'You’re on the waitlist, but we couldn’t send a confirmation email.',
    already: 'You’re already on the waitlist.',
    invalid: 'Enter a valid email address.',
    failed: 'We couldn’t save your email. Please try again.',
    footer: 'Your conversations, organised into work.',
  },
  ms: {
    previewNotice: 'Pratonton ujian: pendaftaran disimpan secara setempat dan e-mel disimulasikan.',
    language: 'Bahasa',
    home: 'Laman utama Wawa',
    docs: 'Dokumentasi',
    github: 'GitHub',
    preview: 'Pratonton sumber terbuka',
    title: 'Jejaki permintaan dalam WhatsApp',
    intro:
      'Cari permintaan, soalan dan tindakan susulan dalam chat yang anda pilih. Setiap item dipautkan kepada perbualan asal.',
    install: 'Hos Wawa sendiri',
    managed: 'Pengehosan terurus',
    fine: 'Anda mengurus pelayan sendiri. Pengehosan terurus belum tersedia.',
    listen: 'Mainkan cerita dengan suara',
    stop: 'Hentikan cerita',
    storyTitle: 'Pernah berlaku?',
    storyHint: 'Contoh cerita ringkas',
    audioError: 'Audio tidak dapat dimainkan. Cuba lagi atau baca contoh di bawah.',
    story: [
      { who: 'Pelanggan', line: 'Dah hantar sebut harga yang baru?', audio: '/audio/ms-1.mp3' },
      {
        who: 'Anda',
        line: 'Saya tahu ada dalam WhatsApp. Tapi dalam chat yang mana satu?',
        audio: '/audio/ms-2.mp3',
      },
      {
        who: 'Anda',
        line: 'Tujuh belas chat! Ini bukan sistem fail. Ini cari harta karun!',
        audio: '/audio/ms-3.mp3',
      },
      {
        who: 'Anda',
        line: 'Jumpa pun. Wawa simpan permintaan bersama mesej asal.',
        audio: '/audio/ms-4.mp3',
      },
    ],
    familiar: 'Pernah alami?',
    casesTitle: 'Permintaan mudah tenggelam dalam chat',
    casesIntro: 'Beberapa contoh situasi yang Wawa boleh bantu anda pantau.',
    examples: [
      {
        category: 'Pengubahsuaian · Chat pelanggan',
        question: 'Tenggelam dalam perbualan',
        message: 'Boleh buat sebut harga untuk pagar belakang juga? Reka bentuk sama macam depan.',
        item: 'Sediakan sebut harga pagar belakang',
        kind: 'Tindakan',
      },
      {
        category: 'Bakeri rumah · Pelanggan baharu',
        question: 'Soalan yang belum dijawab',
        message: 'Boleh sediakan 40 kotak untuk Sabtu? Saya perlu tahu sebelum Rabu.',
        item: 'Boleh sediakan 40 kotak untuk Sabtu?',
        kind: 'Soalan',
      },
      {
        category: 'Sewaan · Chat penyewa',
        question: 'Masalah yang perlu diperiksa',
        message: 'Sinki dapur bocor lagi. Boleh tolong periksa?',
        item: 'Periksa kebocoran sinki dapur',
        kind: 'Tugas',
      },
      {
        category: 'Pereka bebas · Pelanggan',
        question: 'Menunggu orang lain',
        message: 'Boleh hantar logo dalam format SVG? — Boleh, malam ini!',
        item: 'Logo SVG daripada pelanggan',
        kind: 'Menunggu',
      },
      {
        category: 'Kedai · Chat pembekal',
        question: 'Tadi ada sebut tentang penghantaran',
        message: 'Mulai bulan depan, penghantaran percuma untuk lebih 50 karton.',
        item: 'penghantaran',
        kind: 'Carian',
      },
    ],
    exampleMessage: 'Contoh mesej',
    linked: 'Dipautkan kepada mesej asal',
    illustrative: 'Contoh rekaan',
    previous: 'Contoh sebelum ini',
    next: 'Contoh seterusnya',
    pause: 'Jeda',
    play: 'Main',
    privacy:
      'Wawa menggunakan sambungan WhatsApp tidak rasmi; akaun mungkin dikenakan sekatan. Mesej dan imej yang dipilih dihantar kepada penyedia AI yang anda tetapkan.',
    workspace: 'Ruang kerja anda',
    workspaceTitle: 'Ruang kerja pada pelayan anda',
    workspaceText:
      'Semak tugas, soalan dan tindakan susulan di satu tempat. Buka mesej asal apabila anda memerlukan konteks.',
    screenshot: 'Gambaran ruang kerja Wawa yang memaparkan tugas, tindakan, soalan dan peringatan',
    how: 'Cara ia berfungsi',
    howTitle: 'Cara Wawa berfungsi',
    steps: [
      ['Pilih chat anda', 'Pautkan WhatsApp dan pilih perbualan yang ingin diikuti.'],
      [
        'Lihat yang perlu diberi perhatian',
        'Cari permintaan, soalan dan peringatan bersama konteks asal.',
      ],
      [
        'Jalankan ruang kerja anda',
        'Hos Wawa pada pelayan sendiri dan pilih sambungan model anda.',
      ],
    ],
    waitTitle: 'Mahu kami hoskan?',
    waitText:
      'Wawa terurus belum tersedia. Sertai senarai menunggu untuk menerima perkembangan jika ia ditawarkan.',
    email: 'Alamat e-mel',
    emailPlaceholder: 'anda@contoh.com',
    join: 'Sertai senarai menunggu',
    joining: 'Sedang menghantar…',
    consent: 'Dengan menyertai, anda bersetuju menerima perkembangan Wawa terurus melalui e-mel.',
    success: 'Anda sudah menyertai senarai menunggu. E-mel pengesahan telah diminta.',
    saved: 'Anda sudah menyertai senarai menunggu, tetapi e-mel pengesahan tidak dapat dihantar.',
    already: 'Anda sudah berada dalam senarai menunggu.',
    invalid: 'Masukkan alamat e-mel yang sah.',
    failed: 'Alamat e-mel tidak dapat disimpan. Sila cuba lagi.',
    footer: 'Perbualan anda, disusun menjadi kerja.',
  },
};
const guide = 'https://github.com/liongkj/wawa/blob/main/docs/docker-stack.md';
const waitlistEndpoint = import.meta.env.VITE_WAITLIST_API_URL || '/api/waitlist';
const previewMode = import.meta.env.DEV || import.meta.env.VITE_WAITLIST_PREVIEW === '1';

export function App() {
  const [locale, setLocale] = useState('en');
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [manual, setManual] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [visible, setVisible] = useState(false);
  const [storyStep, setStoryStep] = useState(-1);
  const [storyError, setStoryError] = useState(false);
  const [email, setEmail] = useState('');
  const [submitState, setSubmitState] = useState('idle');
  const carouselRef = useRef(null);
  const storyAudio = useRef(null);
  const t = content[locale];
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `Wawa — ${t.title}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.intro);
  }, [locale, t.title, t.intro]);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const q = window.matchMedia('(max-width: 700px)');
    const update = () => setMobile(q.matches);
    update();
    q.addEventListener('change', update);
    return () => q.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0.2,
    });
    observer.observe(carouselRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (paused || reduced || mobile || interacting || !visible) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % t.examples.length), 7000);
    return () => clearInterval(id);
  }, [paused, reduced, mobile, interacting, visible, t.examples.length]);
  function playStoryStep(next) {
    const audio = storyAudio.current;
    if (next >= t.story.length) {
      setStoryStep(-1);
      return;
    }
    setStoryError(false);
    setStoryStep(next);
    audio.src = t.story[next].audio;
    audio.play().catch(() => {
      setStoryError(true);
      setStoryStep(-1);
    });
  }
  function stopStory() {
    storyAudio.current.pause();
    setStoryStep(-1);
  }
  function switchLocale(value) {
    stopStory();
    setStoryError(false);
    setLocale(value);
  }
  useEffect(() => {
    const stopWhenHidden = () => {
      if (document.hidden && storyAudio.current) {
        storyAudio.current.pause();
        setStoryStep(-1);
      }
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => document.removeEventListener('visibilitychange', stopWhenHidden);
  }, []);
  async function joinWaitlist(event) {
    event.preventDefault();
    setSubmitState('loading');
    try {
      const response = await fetch(waitlistEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), locale }),
      });
      const data = await response.json();
      if (!response.ok) {
        setSubmitState(response.status === 400 ? 'invalid' : 'failed');
        return;
      }
      setSubmitState(
        data.status === 'already'
          ? 'already'
          : data.confirmation === 'accepted'
            ? 'success'
            : 'saved',
      );
      setEmail('');
    } catch {
      setSubmitState('failed');
    }
  }
  const item = t.examples[index];
  const navigate = (i) => {
    setPaused(true);
    setManual(true);
    setIndex((i + t.examples.length) % t.examples.length);
  };
  return (
    <>
      <header className="top wrap">
        <a href="#top" className="brand" aria-label={t.home}>
          <img src="/wawa-icon.png" alt="" />
          <span>Wawa</span>
        </a>
        <nav>
          <span className="preview-note">{t.preview}</span>
          <a href={guide}>{t.docs}</a>
          <a href="https://github.com/liongkj/wawa">{t.github} ↗</a>
          <label className="language">
            <span className="sr-only">{t.language}</span>
            <select value={locale} onChange={(event) => switchLocale(event.target.value)}>
              <option value="en">English</option>
              <option value="ms">Bahasa Malaysia</option>
            </select>
          </label>
        </nav>
      </header>
      <main id="top">
        <section className="hero">
          <div className="hero-inner wrap">
            <div className="hero-copy">
              <div className="eyebrow">{t.preview}</div>
              <h1>{t.title}</h1>
              <p>{t.intro}</p>
              <div className="actions">
                <a className="button primary" href={guide}>
                  {t.install} <span aria-hidden="true">↗</span>
                </a>
                <a className="button quiet" href="#managed">
                  {t.managed}
                </a>
              </div>
              <p className="fine">{t.fine}</p>
            </div>
            <div className="story-box">
              <div className="story-top">
                <span>{t.storyTitle}</span>
                <span>{t.storyHint}</span>
              </div>
              {storyStep < 0 ? (
                <p className="story-idle">“{t.story[0].line}”</p>
              ) : (
                <div className="story-scene" aria-live="polite" key={storyStep}>
                  <span>{t.story[storyStep].who}</span>
                  <p>“{t.story[storyStep].line}”</p>
                  {storyStep === 3 && <img src="/wawa-overview.png" alt={t.screenshot} />}
                </div>
              )}
              <button
                className="story-trigger"
                type="button"
                onClick={() => (storyStep < 0 ? playStoryStep(0) : stopStory())}
              >
                {storyStep < 0 ? '▶ ' + t.listen : '■ ' + t.stop}
              </button>
              <audio
                ref={storyAudio}
                preload="none"
                onEnded={() => playStoryStep(storyStep + 1)}
                onError={() => {
                  setStoryError(true);
                  setStoryStep(-1);
                }}
              />
              {storyError && <p role="alert">{t.audioError}</p>}
            </div>
          </div>
        </section>
        <section className="usecases wrap">
          <div className="usecases-intro">
            <div className="eyebrow">{t.familiar}</div>
            <h2>{t.casesTitle}</h2>
            <p>{t.casesIntro}</p>
          </div>
          <div className="carousel-wrap">
            <section
              ref={carouselRef}
              className="carousel"
              aria-roledescription="carousel"
              aria-label={t.familiar}
              onMouseEnter={() => setInteracting(true)}
              onMouseLeave={() => setInteracting(false)}
              onFocus={() => setInteracting(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false);
              }}
            >
              <div className="card-head">
                <span>{item.category}</span>
                <span>
                  {String(index + 1).padStart(2, '0')} /{' '}
                  {String(t.examples.length).padStart(2, '0')}
                </span>
              </div>
              <div className="slide" key={locale + index} aria-live={manual ? 'polite' : 'off'}>
                <h2>{item.question}</h2>
                <div className="message-label">{t.exampleMessage}</div>
                <blockquote>“{item.message}”</blockquote>
                <div className="arrow" aria-hidden="true">
                  ↓
                </div>
                <div className="work-item">
                  <div>
                    <span className="kind">{item.kind}</span>
                    <strong>{item.item}</strong>
                    <small>{t.linked}</small>
                  </div>
                  <span className="open-circle" aria-hidden="true">
                    ○
                  </span>
                </div>
              </div>
              <div className="carousel-footer">
                <span>{t.illustrative}</span>
                <div className="controls">
                  {!reduced && !mobile && (
                    <button className="pause" type="button" onClick={() => setPaused(!paused)}>
                      {paused ? t.play : t.pause}
                    </button>
                  )}
                  <button type="button" onClick={() => navigate(index - 1)} aria-label={t.previous}>
                    ←
                  </button>
                  <button type="button" onClick={() => navigate(index + 1)} aria-label={t.next}>
                    →
                  </button>
                </div>
              </div>
            </section>
            <div className="dots" role="group" aria-label={t.familiar}>
              {t.examples.map((example, i) => (
                <button
                  key={i}
                  className={i === index ? 'active' : ''}
                  onClick={() => navigate(i)}
                  aria-label={example.question}
                  aria-current={i === index ? 'true' : undefined}
                />
              ))}
            </div>
          </div>
        </section>
        <p className="privacy-note wrap">{t.privacy}</p>
        <section className="dark">
          <div className="wrap">
            <div className="dark-intro">
              <div>
                <p className="dark-kicker">{t.workspace}</p>
                <h2>{t.workspaceTitle}</h2>
              </div>
              <p>{t.workspaceText}</p>
            </div>
            <img className="product" src="/wawa-overview.png" alt={t.screenshot} />
          </div>
        </section>
        <section className="how wrap">
          <div>
            <div className="eyebrow">{t.how}</div>
            <h2>{t.howTitle}</h2>
          </div>
          <div className="steps">
            {t.steps.map(([title, body], i) => (
              <article key={title}>
                <span>0{i + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="managed wrap" id="managed">
          <div>
            <div className="eyebrow">{t.managed}</div>
            <h2>{t.waitTitle}</h2>
          </div>
          <div>
            <p>{t.waitText}</p>
            <form onSubmit={joinWaitlist}>
              {previewMode && (
                <p className="preview-warning" role="note">
                  {t.previewNotice}
                </p>
              )}
              <label htmlFor="waitlist-email">{t.email}</label>
              <div className="form-row">
                <input
                  id="waitlist-email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength="254"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t.emailPlaceholder}
                />
                <button className="button primary" disabled={submitState === 'loading'}>
                  {submitState === 'loading' ? t.joining : t.join}
                </button>
              </div>
              <p className="consent">{t.consent}</p>
              {!['idle', 'loading'].includes(submitState) && (
                <p role={['invalid', 'failed'].includes(submitState) ? 'alert' : 'status'}>
                  {t[submitState]}
                </p>
              )}
            </form>
          </div>
        </section>
      </main>
      <footer className="wrap footer">
        <a className="brand" href="#top">
          <img src="/wawa-icon.png" alt="" />
          <span>Wawa</span>
        </a>
        <p>{t.footer}</p>
        <div>
          <a href={guide}>{t.docs}</a>
          <a href="https://github.com/liongkj/wawa">GitHub</a>
        </div>
      </footer>
    </>
  );
}
