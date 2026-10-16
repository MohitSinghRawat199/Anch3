import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileText,
  Layers3,
  LoaderCircle,
  LogIn,
  LogOut,
  MessageSquareText,
  MonitorPlay,
  Plus,
  Sparkles,
  UserRound,
  WandSparkles,
} from "lucide-react";

const examples = ["The future of renewable energy", "How habits shape our lives", "A beginner's guide to investing"];

function App() {
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("General audience");
  const [slideCount, setSlideCount] = useState(5);
  const [style, setStyle] = useState("Modern & minimal");
  const [duration, setDuration] = useState(10);
  const [deck, setDeck] = useState(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [showNotes, setShowNotes] = useState(true);
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("checking");
  const authStatusRef = useRef(authStatus);
  authStatusRef.current = authStatus;
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authPage, setAuthPage] = useState("login");
  const [authSetupMessage, setAuthSetupMessage] = useState("");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const pathToAuthPage = (pathname) => {
      if (pathname === "/register") return "register";
      if (pathname === "/signed-out") return "signed-out";
      return "login";
    };

    async function checkSession() {
      try {
        const healthResponse = await fetch("/api/health");
        if (!healthResponse.ok) throw new Error("The account service is not responding.");
        const health = await healthResponse.json();
        if (!active) return;
        setAiEnabled(health.aiEnabled);
        setAuthEnabled(health.authEnabled);

        if (!health.authEnabled) {
          setAuthSetupMessage(
            !health.mongoUriConfigured
              ? "Account sign-in needs MONGODB_URI. Add your MongoDB Atlas connection string to the server's local .env file."
              : !health.mongoConnected
                ? "The server cannot reach MongoDB Atlas. Check your Atlas Network Access IP allowlist and database connection string, then restart the server."
                : !health.jwtConfigured
                  ? "Account sign-in needs JWT_SECRET. Set a random secret of at least 32 characters in the server's local .env file, then restart."
                  : "Account sign-in is temporarily unavailable. Check the server logs and try again.",
          );
          setAuthStatus("signed-out");
          const page = pathToAuthPage(window.location.pathname);
          setAuthPage(page);
          if (!["/register", "/signed-out", "/login"].includes(window.location.pathname)) {
            window.history.replaceState({}, "", "/login");
          }
          return;
        }

        const sessionResponse = await fetch("/api/auth/me");
        const session = await sessionResponse.json();
        if (!active) return;
        if (sessionResponse.ok && session.user) {
          setUser(session.user);
          setAuthStatus("signed-in");
          if (window.location.pathname !== "/") window.history.replaceState({}, "", "/");
          return;
        }

        setAuthSetupMessage(sessionResponse.status === 503 ? session.error : "");
        setAuthStatus("signed-out");
        const page = pathToAuthPage(window.location.pathname);
        setAuthPage(page);
        if (!["/register", "/signed-out", "/login"].includes(window.location.pathname)) {
          window.history.replaceState({}, "", "/login");
        }
      } catch {
        if (!active) return;
        setAuthEnabled(false);
        setAuthSetupMessage("Unable to check your account right now. Please check the server connection and try again.");
        setAuthStatus("signed-out");
        setAuthPage(pathToAuthPage(window.location.pathname));
        if (!["/register", "/signed-out", "/login"].includes(window.location.pathname)) {
          window.history.replaceState({}, "", "/login");
        }
      }
    }

    const onPopState = () => {
      setAuthPage(pathToAuthPage(window.location.pathname));
      if (window.location.pathname === "/" && authStatusRef.current !== "signed-in") {
        window.history.replaceState({}, "", "/login");
      }
    };
    async function revalidateSession() {
      if (!active || authStatusRef.current !== "signed-in") return;
      try {
        const response = await fetch("/api/auth/me");
        if (response.status === 401) {
          setUser(null);
          setDeck(null);
          setAuthError("Your session has expired. Please sign in again.");
          setAuthPage("login");
          setAuthStatus("signed-out");
          window.history.replaceState({}, "", "/login");
          return;
        }
        if (!response.ok) return;
        const session = await response.json();
        if (session.user) return;
        setUser(null);
        setDeck(null);
        setAuthError("Your session has expired. Please sign in again.");
        setAuthPage("login");
        setAuthStatus("signed-out");
        window.history.replaceState({}, "", "/login");
      } catch (sessionError) {
        console.error("Could not refresh the active session:", sessionError);
      }
    }
    window.addEventListener("popstate", onPopState);
    window.addEventListener("focus", revalidateSession);
    const sessionCheckTimer = window.setInterval(revalidateSession, 5 * 60 * 1000);
    checkSession();
    return () => {
      active = false;
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("focus", revalidateSession);
      window.clearInterval(sessionCheckTimer);
    };
  }, []);

  const currentSlide = deck?.slides[activeSlide];
  const progress = useMemo(
    () => (deck ? `${Math.round(((activeSlide + 1) / deck.slides.length) * 100)}%` : "0%"),
    [activeSlide, deck],
  );

  async function generatePresentation(event) {
    event.preventDefault();
    if (!topic.trim()) {
      setError("Add a topic to get started.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, audience, slideCount, style, duration }),
      });
      const result = await response.json();
      if (response.status === 401) {
        setUser(null);
        setDeck(null);
        setAuthPage("login");
        setAuthError(result.error || "Your session has expired. Please sign in again.");
        setAuthStatus("signed-out");
        window.history.replaceState({}, "", "/login");
        return;
      }
      if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
      setDeck(result);
      setActiveSlide(0);
    } catch (generationError) {
      setError(generationError.message || "Could not reach the slide generator. Is the server running?");
    } finally {
      setLoading(false);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!authEnabled) {
      setAuthError(authSetupMessage || "Account sign-in is not currently available.");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    try {
      const response = await fetch(`/api/auth/${authPage === "register" ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(authPage === "register" ? { name: authName } : {}),
          email: authEmail,
          password: authPassword,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sign in. Please try again.");
      setUser(result.user);
      setAuthStatus("signed-in");
      window.history.replaceState({}, "", "/");
      setAuthPassword("");
      setAuthName("");
    } catch (authRequestError) {
      setAuthError(authRequestError.message || "Could not reach the account service.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Could not sign out. Please try again.");
      setUser(null);
      setDeck(null);
      setAuthStatus("signed-out");
      setAuthPage("signed-out");
      setAuthError("");
      window.history.pushState({}, "", "/signed-out");
    } catch (signOutError) {
      setAuthError(signOutError.message);
    }
  }

  function navigateAuthPage(page) {
    setAuthError("");
    setAuthPage(page);
    window.history.pushState({}, "", page === "signed-out" ? "/signed-out" : `/${page}`);
  }

  async function exportPdf() {
    if (!deck) return;
    setExportingPdf(true);
    setExportError("");
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: [960, 540], compress: true });
      const colorsByStyle = {
        "Bold & colorful": { background: "#345B4B", ink: "#FCF9EF", muted: "#E2EADF", accent: "#E5CD84", line: "#547564" },
        Professional: { background: "#F4F6F9", ink: "#27364B", muted: "#68788A", accent: "#547CA4", line: "#DCE3EB" },
        Playful: { background: "#FFF7EF", ink: "#4E3E49", muted: "#82727A", accent: "#C47B62", line: "#EDE0D8" },
        Editorial: { background: "#FAF5E9", ink: "#3E3730", muted: "#81796B", accent: "#9B7655", line: "#E8E0D2" },
        Academic: { background: "#F4F5F8", ink: "#303B50", muted: "#727D90", accent: "#61789F", line: "#E0E4ED" },
      };
      const colors = colorsByStyle[style] || {
        background: "#F8F8F2",
        ink: "#293C31",
        muted: "#778076",
        accent: "#6F9671",
        line: "#E7E9DF",
      };
      const pageWidth = 960;
      const pageHeight = 540;
      const contentX = 76;
      const contentWidth = 770;
      const footerY = 484;
      const hex = (value) => [
        Number.parseInt(value.slice(1, 3), 16),
        Number.parseInt(value.slice(3, 5), 16),
        Number.parseInt(value.slice(5, 7), 16),
      ];
      const setTextColor = (value) => pdf.setTextColor(...hex(value));
      const setDrawColor = (value) => pdf.setDrawColor(...hex(value));
      const setFillColor = (value) => pdf.setFillColor(...hex(value));
      const fileName = `${String(deck.title || "slidecraft-presentation")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80) || "slidecraft-presentation"}.pdf`;

      pdf.setProperties({ title: String(deck.title || "Slidecraft presentation"), subject: "Presentation slides", author: "Slidecraft" });
      deck.slides.forEach((slide, index) => {
        if (index > 0) pdf.addPage([pageWidth, pageHeight], "landscape");
        setFillColor(colors.background);
        pdf.rect(0, 0, pageWidth, pageHeight, "F");

        setDrawColor(colors.line);
        pdf.setLineWidth(1);
        pdf.circle(880, 245, 134, "S");
        pdf.circle(880, 245, 105, "S");
        pdf.circle(880, 245, 75, "S");

        setTextColor(colors.accent);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.text("SLIDECRAFT", contentX, 48);
        setTextColor(colors.muted);
        pdf.setFont("helvetica", "normal");
        pdf.text(`${String(index + 1).padStart(2, "0")} / ${String(deck.slides.length).padStart(2, "0")}`, pageWidth - 76, 48, { align: "right" });

        setTextColor(colors.accent);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.text(`${String(style).toUpperCase()} PRESENTATION`, contentX, 122);

        const title = String(slide.title || "Untitled slide");
        const titleLines = pdf.splitTextToSize(title, contentWidth);
        const titleFontSize = titleLines.length > 2 ? 29 : 38;
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(titleFontSize);
        setTextColor(colors.ink);
        const titleLineHeight = titleFontSize * 1.16;
        const titleY = 172;
        pdf.text(titleLines, contentX, titleY, { lineHeightFactor: 1.16 });

        const subtitle = String(slide.subtitle || "");
        const subtitleY = titleY + titleLines.length * titleLineHeight + 11;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(16);
        setTextColor(colors.muted);
        const subtitleLines = pdf.splitTextToSize(subtitle, contentWidth);
        pdf.text(subtitleLines, contentX, subtitleY, { lineHeightFactor: 1.3 });

        const bulletItems = Array.isArray(slide.bullets) ? slide.bullets : [];
        const bulletStartY = subtitleY + subtitleLines.length * 22 + 24;
        let bulletFontSize = 17;
        let bulletLineHeight = 25;
        let bulletGap = 13;
        const prepareBullets = () => {
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(bulletFontSize);
          const rows = bulletItems.map((bullet) => pdf.splitTextToSize(String(bullet), contentWidth - 38));
          const totalHeight = rows.reduce((height, lines) => height + lines.length * bulletLineHeight + bulletGap, 0);
          return { rows, totalHeight };
        };
        let preparedBullets = prepareBullets();
        if (bulletStartY + preparedBullets.totalHeight > footerY - 16) {
          bulletFontSize = 14;
          bulletLineHeight = 20;
          bulletGap = 9;
          preparedBullets = prepareBullets();
        }

        let bulletY = bulletStartY;
        preparedBullets.rows.forEach((lines, bulletIndex) => {
          setTextColor(colors.accent);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(10);
          pdf.text(String(bulletIndex + 1).padStart(2, "0"), contentX, bulletY);
          setTextColor(colors.ink);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(bulletFontSize);
          pdf.text(lines, contentX + 38, bulletY, { lineHeightFactor: 1.2 });
          bulletY += lines.length * bulletLineHeight + bulletGap;
        });

        setDrawColor(colors.line);
        pdf.setLineWidth(1);
        pdf.line(contentX, footerY, pageWidth - 76, footerY);
        setTextColor(colors.muted);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.text(String(topic || deck.title || ""), contentX, footerY + 21, { maxWidth: 700 });
        setTextColor(colors.accent);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(12);
        pdf.text("*", pageWidth - 76, footerY + 22, { align: "right" });
      });

      const pdfUrl = URL.createObjectURL(pdf.output("blob"));
      const downloadLink = document.createElement("a");
      downloadLink.href = pdfUrl;
      downloadLink.download = fileName;
      downloadLink.style.display = "none";
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
    } catch (pdfError) {
      console.error("PDF export failed:", pdfError);
      setExportError(pdfError.message || "Could not create the PDF. Please try again.");
    } finally {
      setExportingPdf(false);
    }
  }

  function moveSlide(direction) {
    setActiveSlide((index) => Math.min(Math.max(index + direction, 0), (deck?.slides.length || 1) - 1));
  }

  if (authStatus !== "signed-in") {
    return (
      <div className="auth-page-shell">
        <header className="auth-page-header">
          <a className="brand" href="/login" aria-label="Slidecraft sign in">
            <span className="brand-mark"><Layers3 size={19} strokeWidth={2.4} /></span>
            <span>slidecraft<span className="brand-period">.</span></span>
          </a>
          <span className="auth-header-note">A little room for big ideas.</span>
        </header>
        <main className="auth-page-main">
          {authStatus === "checking" ? (
            <section className="auth-card auth-loading-card" aria-live="polite">
              <LoaderCircle className="spinner auth-loading-icon" size={22} />
              <p>Checking your sign-in…</p>
            </section>
          ) : authPage === "signed-out" ? (
            <section className="auth-card signed-out-card">
              <span className="auth-mark"><Check size={20} /></span>
              <span className="eyebrow auth-eyebrow">SESSION ENDED</span>
              <h1>You’re signed out.</h1>
              <p className="auth-intro">Your presentation workspace is protected. Sign in again whenever you’re ready to create.</p>
              {authSetupMessage && <p className="auth-setup-note">{authSetupMessage}</p>}
              <button className="generate-button auth-submit" onClick={() => navigateAuthPage("login")}>
                <LogIn size={16} /> Sign in
              </button>
              <button className="auth-text-button" onClick={() => navigateAuthPage("register")}>Create a new account</button>
            </section>
          ) : (
            <section className="auth-card">
              <span className="auth-mark"><Layers3 size={20} /></span>
              <span className="eyebrow auth-eyebrow">{authPage === "register" ? "YOUR NEXT GREAT IDEA STARTS HERE" : "WELCOME TO SLIDECRAFT"}</span>
              <h1>{authPage === "register" ? "Create your account." : "Make your point."}</h1>
              <p className="auth-intro">
                {authPage === "register"
                  ? "Sign up to enter your private presentation workspace."
                  : "Sign in to continue to your presentation workspace."}
              </p>
              <form className="auth-form" onSubmit={submitAuth}>
                {authPage === "register" && (
                  <label>Your name<input autoComplete="name" required minLength={1} maxLength={80} value={authName} onChange={(event) => setAuthName(event.target.value)} placeholder="Jane Smith" /></label>
                )}
                <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@example.com" /></label>
                <label>Password<input type="password" autoComplete={authPage === "register" ? "new-password" : "current-password"} required minLength={authPage === "register" ? 12 : 1} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder={authPage === "register" ? "At least 12 characters" : "Enter your password"} /></label>
                {authPage === "register" && <p className="password-help">Use at least 12 characters. Passwords are limited to 72 UTF-8 bytes.</p>}
                {authError && <div role="alert" className="error-message auth-error">{authError}</div>}
                {!authEnabled && authSetupMessage && <p className="auth-setup-note">{authSetupMessage}</p>}
                <button className="generate-button auth-submit" type="submit" disabled={authLoading || !authEnabled}>
                  {authLoading ? <><LoaderCircle className="spinner" size={16} /> Please wait…</> : authPage === "register" ? "Create account" : "Sign in"}
                  {!authLoading && <ArrowRight size={16} />}
                </button>
              </form>
              <p className="auth-switch">
                {authPage === "register" ? "Already registered?" : "New to Slidecraft?"}
                <button onClick={() => navigateAuthPage(authPage === "register" ? "login" : "register")}>
                  {authPage === "register" ? "Sign in" : "Create an account"}
                </button>
              </p>
            </section>
          )}
        </main>
        <footer className="auth-page-footer"><span>SLIDECRAFT STUDIO</span><span>YOUR IDEAS, YOUR SPACE <span className="footer-star">✳</span></span></footer>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Slidecraft home">
          <span className="brand-mark"><Layers3 size={19} strokeWidth={2.4} /></span>
          <span>slidecraft<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-right">
          <span className={`mode-pill ${aiEnabled ? "mode-ai" : ""}`}>
            <span className="status-dot" />
            {aiEnabled ? "AI generator ready" : "Studio mode"}
          </span>
          {user ? (
            <>
              <span className="account-name"><UserRound size={14} /> {user.name}</span>
              <button className="signout-button" onClick={signOut}><LogOut size={14} /> Sign out</button>
            </>
          ) : (
            <button className="signin-button" onClick={() => navigateAuthPage("login")}>
              <LogIn size={14} /> Sign in
            </button>
          )}
          <button className="icon-button help-button" aria-label="Help" title="Create a deck by choosing a topic and your preferences">
            <CircleHelp size={19} />
          </button>
          <span className="avatar">{user ? user.name.slice(0, 1).toUpperCase() : "S"}</span>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span className="eyebrow">WORKSPACE</span>
            <button className="icon-button small" aria-label="New presentation" onClick={() => setDeck(null)}><Plus size={17} /></button>
          </div>
          <button className={`nav-item ${!deck ? "selected" : ""}`} onClick={() => setDeck(null)}>
            <WandSparkles size={17} /><span>New presentation</span>
          </button>
          <button className={`nav-item ${deck ? "selected" : ""}`} onClick={() => deck && document.querySelector(".preview-section")?.scrollIntoView({ behavior: "smooth" })}>
            <FileText size={17} /><span>My presentations</span>
            {deck && <span className="nav-count">1</span>}
          </button>
          <div className="sidebar-rule" />
          <div className="sidebar-heading recent-heading"><span className="eyebrow">RECENT</span></div>
          {deck ? (
            <button className="recent-card" onClick={() => setActiveSlide(0)}>
              <span className="recent-icon"><FileText size={15} /></span>
              <span className="recent-copy"><strong>{deck.title}</strong><small>{deck.slides.length} slides · just now</small></span>
            </button>
          ) : <p className="empty-recent">Your presentations will show up here.</p>}
          <div className="sidebar-bottom">
            <div className="tip-card">
              <span className="tip-icon"><Sparkles size={15} /></span>
              <strong>A little tip</strong>
              <p>The more specific your topic, the more focused your slides will be.</p>
            </div>
            <span className="sidebar-version">SLIDECRAFT STUDIO <span>·</span> BETA</span>
          </div>
        </aside>

        <section className="main-content">
          {authError && <div role="alert" className="error-message session-error">{authError}</div>}
          <div className="page-heading">
            <div>
              <span className="eyebrow page-kicker">YOUR NEXT GREAT IDEA</span>
              <h1>Make your point.<br /><span>Beautifully.</span></h1>
              <p className="page-description">From a spark of an idea to a story worth sharing.</p>
            </div>
            <div className="heading-art" aria-hidden="true">
              <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
              <div className="art-spark"><Sparkles size={29} /></div>
              <span className="art-dot dot-one" /><span className="art-dot dot-two" /><span className="art-dot dot-three" />
            </div>
          </div>

          <form className="builder-card" onSubmit={generatePresentation}>
            <div className="card-topline">
              <span className="step-badge">01</span>
              <span>LET’S SET THE SCENE</span>
              <span className="required-note">Choose your setup to shape the first draft</span>
            </div>
            <label className="field-label" htmlFor="topic">What’s your presentation about?</label>
            <div className="topic-input-wrap">
              <Sparkles size={18} className="input-sparkle" />
              <input
                id="topic"
                type="text"
                maxLength={160}
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="e.g. Why sleep is your secret superpower"
              />
              {topic && <span className="character-count">{topic.length}/160</span>}
            </div>
            <div className="suggestion-row">
              <span>TRY</span>
              {examples.map((example) => (
                <button type="button" className="suggestion-chip" key={example} onClick={() => setTopic(example)}>{example}</button>
              ))}
            </div>

            <div className="form-divider" />
            <div className="options-heading"><span className="step-badge">02</span><span>MAKE IT YOURS</span></div>
            <div className="options-grid">
              <label className="form-field">
                <span className="field-title"><BookOpen size={15} /> WHO’S IT FOR?</span>
                <span className="select-wrap">
                  <select value={audience} onChange={(event) => setAudience(event.target.value)}>
                    <option>General audience</option><option>Students</option><option>Business professionals</option>
                    <option>Beginners</option><option>Children</option><option>Technical audience</option>
                  </select><ChevronDown size={15} />
                </span>
              </label>
              <label className="form-field">
                <span className="field-title"><Sparkles size={15} /> THE VIBE</span>
                <span className="select-wrap">
                  <select value={style} onChange={(event) => setStyle(event.target.value)}>
                    <option>Modern &amp; minimal</option><option>Bold &amp; colorful</option><option>Professional</option>
                    <option>Playful</option><option>Editorial</option><option>Academic</option>
                  </select><ChevronDown size={15} />
                </span>
              </label>
              <label className="form-field">
                <span className="field-title"><Layers3 size={15} /> NUMBER OF SLIDES</span>
                <span className="select-wrap">
                  <select value={slideCount} onChange={(event) => setSlideCount(Number(event.target.value))}>
                    {[3, 4, 5].map((count) => <option key={count} value={count}>{count} slides</option>)}
                  </select><ChevronDown size={15} />
                </span>
              </label>
              <label className="form-field">
                <span className="field-title"><Clock3 size={15} /> PRESENTATION LENGTH</span>
                <span className="select-wrap">
                  <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
                    {[3, 5, 10, 15, 20, 30, 45].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                  </select><ChevronDown size={15} />
                </span>
              </label>
            </div>

            {error && <div role="alert" className="error-message">{error}</div>}
            <div className="generate-row">
              <div className="privacy-note"><Check size={14} /><span>Your ideas stay yours. Always.</span></div>
              <button className="generate-button" type="submit" disabled={loading}>
                {loading ? <><LoaderCircle className="spinner" size={17} /> Creating your deck…</> : <><WandSparkles size={17} /> Generate my slides <ArrowRight size={17} /></>}
              </button>
            </div>
          </form>

          {!deck && !loading && (
            <div className="bottom-note">
              <span className="bottom-note-icon"><MessageSquareText size={16} /></span>
              <span><strong>Good ideas deserve great storytelling.</strong> We’ll help you find the flow.</span>
              <span className="note-decoration">✳</span>
            </div>
          )}

          {deck && currentSlide && (
            <section className="preview-section">
              <div className="preview-heading">
                <div>
                  <span className="eyebrow">YOUR FIRST DRAFT</span>
                  <h2>{deck.title}</h2>
                </div>
                <div className="preview-actions">
                  <button className="secondary-button" onClick={() => setShowNotes((value) => !value)}>
                    <MessageSquareText size={15} /> {showNotes ? "Hide notes" : "Speaker notes"}
                  </button>
                  <button className="secondary-button export-button" onClick={exportPdf} disabled={exportingPdf} aria-label="Download presentation as PDF">
                    {exportingPdf ? <LoaderCircle className="spinner" size={15} /> : <ArrowDownToLine size={15} />}
                    {exportingPdf ? "Preparing PDF…" : "Export PDF"}
                  </button>
                </div>
              </div>
              {exportError && <div role="alert" className="error-message export-error">{exportError}</div>}
              <div className="slide-stage">
                <div key={activeSlide} className={`slide-canvas slide-style-${style.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
                  <div className="slide-top"><span className="slide-brand"><span className="mini-mark">✳</span> SLIDECRAFT</span><span>{String(activeSlide + 1).padStart(2, "0")} / {String(deck.slides.length).padStart(2, "0")}</span></div>
                  <div className="slide-content">
                    <span className="slide-overline">A {style.toLowerCase()} presentation</span>
                    <h3>{currentSlide.title}</h3>
                    <p className="slide-subtitle">{currentSlide.subtitle}</p>
                    <ul>{currentSlide.bullets.map((bullet, index) => <li key={bullet}><span className="bullet-number">0{index + 1}</span>{bullet}</li>)}</ul>
                  </div>
                  <div className="slide-footer"><span>{topic}</span><span className="slide-footer-mark">✳</span></div>
                  <div className="slide-decoration" aria-hidden="true" />
                </div>
                <div className="slide-controls">
                  <button className="icon-button control-button" aria-label="Previous slide" disabled={activeSlide === 0} onClick={() => moveSlide(-1)}><ArrowLeft size={17} /></button>
                  <span className="slide-position">Slide <strong>{activeSlide + 1}</strong> of {deck.slides.length}</span>
                  <button className="icon-button control-button" aria-label="Next slide" disabled={activeSlide === deck.slides.length - 1} onClick={() => moveSlide(1)}><ArrowRight size={17} /></button>
                  <div className="progress-track"><span style={{ width: progress }} /></div>
                  <button className="icon-button control-button present-button" aria-label="Go to first slide" onClick={() => setActiveSlide(0)}><MonitorPlay size={17} /></button>
                </div>
              </div>
              {showNotes && <div className="speaker-notes"><div className="notes-label"><MessageSquareText size={15} /> SPEAKER NOTES</div><p>{currentSlide.speakerNotes}</p></div>}
              <div className="draft-disclaimer"><Sparkles size={14} /> {deck.mode === "ai" ? "AI-generated draft — review facts and add sources before presenting." : "Studio mode creates a quick outline. Add a free Gemini API key for AI-written slides."}</div>
            </section>
          )}

          <footer className="page-footer"><span>MADE FOR THE MOMENT YOU FIND YOUR WORDS</span><span>SLIDECRAFT <span className="footer-star">✳</span> 2026</span></footer>
        </section>
      </main>
    </div>
  );
}

export default App;
