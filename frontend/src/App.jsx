import { useEffect, useRef, useState } from "react";
import { askQuestion, getBackendStatus, processVideo } from "./api";
import "./App.css";

const SUGGESTED_QUESTIONS = [
  "What is this video about?",
  "What are the main points?",
  "Explain the key concepts",
  "Give me a summary",
];

const iconShapes = {
  play: <path d="m9 6 9 6-9 6z" fill="currentColor" stroke="none" />,
  youtube: (
    <>
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8Z" fill="currentColor" stroke="none" />
      <path d="m9.6 15.6 6.2-3.6-6.2-3.6z" fill="var(--icon-contrast, #fff)" stroke="none" />
    </>
  ),
  sparkles: (
    <>
      <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
      <path d="m19 14 .9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14Z" />
      <path d="m5 14 .7 2.3L8 17l-2.3.7L5 20l-.7-2.3L2 17l2.3-.7L5 14Z" />
    </>
  ),
  link: <><path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20.9 13A8.5 8.5 0 0 1 11 3.1 8.7 8.7 0 1 0 20.9 13Z" />,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  arrow: <><path d="M7 17 17 7" /><path d="M7 7h10v10" /></>,
  video: <><rect x="3" y="5" width="13" height="14" rx="3" /><path d="m16 10 5-3v10l-5-3" /></>,
  message: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" /></>,
};

function Icon({ name, size = 18, strokeWidth = 1.8, className = "" }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconShapes[name]}
    </svg>
  );
}

function getErrorMessage(error) {
  return (
    error?.response?.data?.detail ||
    error?.response?.data?.error ||
    error?.message ||
    "An unexpected error occurred."
  );
}

function isYouTubeUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const isYouTubeHost =
      host === "youtu.be" ||
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtube-nocookie.com";
    const videoId =
      parsed.searchParams.get("v") ||
      parsed.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1] ||
      (host === "youtu.be" ? parsed.pathname.slice(1).split("/")[0] : null);
    return isYouTubeHost && /^[\w-]{11}$/.test(videoId || "");
  } catch {
    return false;
  }
}

function Header({ theme, onToggleTheme }) {
  return (
    <header className="site-header">
      <div className="brand-lockup">
        <div className="brand-mark"><Icon name="play" size={22} /></div>
        <div className="brand-copy">
          <span className="brand-name">YT RAG</span>
          <span className="brand-tagline">Video research workspace</span>
        </div>
      </div>
      <div className="header-actions">
        <span className="local-badge"><span className="status-dot" /> Local AI</span>
        <button
          className="theme-toggle"
          type="button"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} size={18} />
        </button>
      </div>
    </header>
  );
}

function VideoUrlForm({
  value,
  onChange,
  onSubmit,
  disabled,
  processing,
  compact = false,
}) {
  return (
    <form className={`url-card${compact ? " url-card-compact" : ""}`} onSubmit={onSubmit}>
      <label className="field-label" htmlFor={compact ? "new-video-url" : "video-url"}>
        YouTube video link
      </label>
      <div className="url-form-row">
        <div className="url-input-wrap">
          <Icon name="link" size={19} className="input-icon" />
          <input
            id={compact ? "new-video-url" : "video-url"}
            type="url"
            placeholder="Paste a YouTube video URL..."
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoComplete="url"
            disabled={disabled}
            aria-describedby={compact ? undefined : "url-help"}
          />
        </div>
        <button className="primary-button process-button" type="submit" disabled={disabled}>
          {processing ? <span className="spinner" aria-hidden="true" /> : <Icon name="sparkles" size={17} />}
          <span>{processing ? "Processing video..." : "Process video"}</span>
        </button>
      </div>
      {!compact && (
        <div className="form-footnote" id="url-help">
          <span><Icon name="check" size={14} /> Transcript-powered answers</span>
          <span><Icon name="check" size={14} /> Local AI models</span>
        </div>
      )}
    </form>
  );
}

function LandingIllustration() {
  return (
    <div className="video-art" aria-hidden="true">
      <div className="art-orbit orbit-one" />
      <div className="art-orbit orbit-two" />
      <div className="art-topline"><span className="art-live-dot" /> VIDEO TO INSIGHT</div>
      <div className="art-screen">
        <div className="art-screen-top"><span /><span /><span /><small>VIDEO TRANSCRIPT</small></div>
        <div className="art-play"><Icon name="play" size={28} /></div>
        <div className="art-waveform">
          {[18, 30, 23, 40, 26, 48, 33, 58, 35, 47, 24, 38, 19, 29, 42, 25, 34, 18].map((height, index) => (
            <i key={index} style={{ "--bar-height": `${height}px` }} />
          ))}
        </div>
        <div className="art-timestamp"><span>TRANSCRIPT</span><span>READY WHEN YOU ARE</span></div>
      </div>
      <div className="art-flow flow-transcript"><span className="flow-icon"><Icon name="video" size={16} /></span><span>Transcript</span><Icon name="check" size={14} className="flow-check" /></div>
      <div className="art-flow flow-search"><span className="flow-icon"><Icon name="sparkles" size={16} /></span><span>Smart search</span><Icon name="check" size={14} className="flow-check" /></div>
      <div className="art-caption">One video. Every important detail.</div>
    </div>
  );
}

function LandingPage({
  url,
  setUrl,
  onProcess,
  action,
  errorMessage,
  clearError,
}) {
  return (
    <main className="landing-page page-enter">
      <section className="landing-copy">
        <div className="eyebrow"><span className="eyebrow-line" /> YOUR VIDEO, IN CONTEXT</div>
        <h1>Chat with any<br /><span>YouTube video.</span></h1>
        <p className="hero-description">
          Turn a video into a conversation. Get clear answers grounded in its transcript, powered by local AI.
        </p>
        <VideoUrlForm
          value={url}
          onChange={(value) => { setUrl(value); clearError(); }}
          onSubmit={onProcess}
          disabled={action !== null}
          processing={action === "processing"}
        />
        {errorMessage && <p className="error-banner" role="alert">{errorMessage}</p>}
        {action === "processing" && (
          <div className="processing-note" role="status" aria-live="polite">
            <span className="processing-pulse" /> Fetching captions and preparing your video...
          </div>
        )}
      </section>
      <LandingIllustration />
      <div className="landing-bottom-note"><span className="tiny-shield"><Icon name="check" size={13} /></span> Built for focused video research</div>
    </main>
  );
}

function VideoStatusCard({ video }) {
  const shortId = video.videoId ? `${video.videoId.slice(0, 5)}…${video.videoId.slice(-4)}` : "YouTube video";
  const readableLanguage = video.language ? `${video.language.toUpperCase()} captions` : "Transcript ready";
  return (
    <div className="video-status-card">
      <div className="video-card-visual"><Icon name="youtube" size={28} /></div>
      <div className="video-card-copy">
        <div className="video-ready-label"><span className="status-dot" /> VIDEO PROCESSED</div>
        <div className="video-card-title">Video {shortId}</div>
        <div className="video-card-meta">{readableLanguage}</div>
      </div>
      {video.url && (
        <a className="video-open-link" href={video.url} target="_blank" rel="noreferrer" aria-label="Open processed video in YouTube">
          <Icon name="arrow" size={16} />
        </a>
      )}
    </div>
  );
}

function SuggestedQuestions({ onChoose, disabled }) {
  return (
    <div className="suggested-section">
      <div className="suggested-heading"><span className="suggestion-spark"><Icon name="sparkles" size={16} /></span><span>Try asking</span></div>
      <div className="suggestion-grid">
        {SUGGESTED_QUESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" className="suggestion-button" onClick={() => onChoose(suggestion)} disabled={disabled}>
            <span>{suggestion}</span><Icon name="arrow" size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === "user";
  return (
    <article className={`message-row ${isUser ? "message-user" : "message-assistant"}`}>
      {!isUser && <div className="assistant-avatar"><Icon name="sparkles" size={17} /></div>}
      <div className="message-column">
        <div className="message-label">{isUser ? "YOU" : "YT RAG"}</div>
        <div className={`message-bubble ${isUser ? "user-bubble" : "assistant-bubble"}${message.isError ? " message-error" : ""}`}>
          {!isUser && message.grounded !== undefined && (
            <div className={`grounding-label ${message.grounded ? "grounded" : "not-grounded"}`}>
              <Icon name={message.grounded ? "check" : "video"} size={13} />
              {message.grounded ? "From the transcript" : "Transcript check"}
            </div>
          )}
          <div className="message-text">{message.text}</div>
        </div>
      </div>
      {isUser && <div className="user-avatar">You</div>}
    </article>
  );
}

function ThinkingMessage() {
  return (
    <div className="message-row message-assistant" role="status" aria-live="polite">
      <div className="assistant-avatar"><Icon name="sparkles" size={17} /></div>
      <div className="message-column">
        <div className="message-label">YT RAG</div>
        <div className="thinking-bubble"><span className="thinking-dots"><i /><i /><i /></span><span>Finding an answer in the transcript...</span></div>
      </div>
    </div>
  );
}

function ChatComposer({ question, setQuestion, onAsk, disabled, thinking, inputRef }) {
  const handleChange = (event) => {
    setQuestion(event.target.value);
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 144)}px`;
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      onAsk();
    }
  };

  return (
    <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); onAsk(); }}>
      <label className="sr-only" htmlFor="chat-question">Ask a question about the video</label>
      <textarea
        id="chat-question"
        ref={inputRef}
        rows={1}
        value={question}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about this video..."
        disabled={disabled}
        aria-describedby="composer-hint"
      />
      <button className="send-button" type="submit" disabled={disabled || !question.trim()} aria-label="Send question">
        {thinking ? <span className="spinner" aria-hidden="true" /> : <Icon name="send" size={18} />}
      </button>
      <div className="composer-hint" id="composer-hint"><span>Enter to send</span><span className="hint-divider">·</span><span>Shift + Enter for a new line</span></div>
    </form>
  );
}

function ProcessedWorkspace({
  video,
  question,
  setQuestion,
  chat,
  action,
  onAsk,
  inputRef,
  latestMessageRef,
  url,
  setUrl,
  onProcess,
  showNewVideo,
  setShowNewVideo,
  errorMessage,
  clearError,
}) {
  return (
    <main className="workspace page-enter">
      <div className="workspace-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> VIDEO WORKSPACE</div>
          <h1>Let’s get into it.</h1>
        </div>
        <div className="workspace-ready"><span className="status-dot" /> Ready to chat</div>
      </div>

      <div className="workspace-grid">
        <aside className="video-sidebar" aria-label="Processed video details">
          <VideoStatusCard video={video} />
          <button className="change-video-button" type="button" onClick={() => { setShowNewVideo((current) => !current); clearError(); }} disabled={action !== null}>
            <Icon name={showNewVideo ? "check" : "play"} size={16} />
            {showNewVideo ? "Keep this video" : "Process another video"}
          </button>
          {showNewVideo && (
            <div className="new-video-panel page-enter">
              <p className="new-video-title">Switch video</p>
              <p className="new-video-description">Your conversation will reset after the new transcript is ready.</p>
              <VideoUrlForm
                compact
                value={url}
                onChange={(value) => { setUrl(value); clearError(); }}
                onSubmit={onProcess}
                disabled={action !== null}
                processing={action === "processing"}
              />
              {errorMessage && <p className="error-banner compact-error" role="alert">{errorMessage}</p>}
            </div>
          )}
          {!showNewVideo && errorMessage && <p className="error-banner sidebar-error" role="alert">{errorMessage}</p>}
          <div className="sidebar-note">
            <div className="sidebar-note-icon"><Icon name="message" size={17} /></div>
            <div><strong>Answers from your video</strong><span>Ask naturally. YT RAG searches the transcript for context.</span></div>
          </div>
        </aside>

        <section className="chat-panel" aria-label="Video conversation">
          <div className="chat-panel-heading">
            <div className="chat-title-lockup"><div className="chat-heading-icon"><Icon name="message" size={18} /></div><div><h2>Conversation</h2><p>Ask questions about the processed video</p></div></div>
            <span className="local-context-badge"><span className="status-dot" /> Video context</span>
          </div>
          <div className="chat-messages" aria-live="polite">
            {chat.length === 0 ? (
              <div className="empty-chat page-enter">
                <div className="empty-chat-icon"><Icon name="sparkles" size={22} /></div>
                <h3>Where should we start?</h3>
                <p>Your video is ready. Choose a prompt or ask in your own words.</p>
                <SuggestedQuestions onChoose={onAsk} disabled={action !== null} />
              </div>
            ) : (
              <div className="message-list">
                {chat.map((message, index) => (
                  <ChatMessage key={`${index}-${message.role}-${message.text.slice(0, 20)}`} message={message} />
                ))}
                {action === "asking" && <ThinkingMessage />}
                <div ref={latestMessageRef} />
              </div>
            )}
          </div>
          <ChatComposer
            question={question}
            setQuestion={setQuestion}
            onAsk={() => onAsk(question)}
            disabled={action !== null}
            thinking={action === "asking"}
            inputRef={inputRef}
          />
        </section>
      </div>
      {action === "processing" && <div className="workspace-processing" role="status" aria-live="polite"><span className="spinner" /> Processing the new video transcript...</div>}
    </main>
  );
}

function App() {
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState(null);
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState([]);
  const [action, setAction] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [showNewVideo, setShowNewVideo] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("yt-rag-theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const latestMessageRef = useRef(null);
  const questionInputRef = useRef(null);

  useEffect(() => {
    let active = true;
    getBackendStatus()
      .then(({ data }) => {
        if (!active || !data.processed) return;
        const restoredUrl = `https://www.youtube.com/watch?v=${data.video_id}`;
        setVideo({
          videoId: data.video_id,
          url: restoredUrl,
          language: data.transcript_language,
          chunkCount: data.chunk_count,
        });
        setUrl(restoredUrl);
      })
      .catch((error) => {
        if (active) setErrorMessage(`Backend status unavailable: ${getErrorMessage(error)}`);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem("yt-rag-theme", theme); } catch { /* Theme still works for this session. */ }
  }, [theme]);

  useEffect(() => {
    if (!latestMessageRef.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    latestMessageRef.current.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
  }, [chat, action]);

  const handleProcess = async (event) => {
    event?.preventDefault();
    if (action !== null) return;
    const submittedUrl = url.trim();
    if (!isYouTubeUrl(submittedUrl)) {
      setErrorMessage("Please enter a valid YouTube video URL.");
      return;
    }

    setAction("processing");
    setErrorMessage("");
    try {
      const { data } = await processVideo(submittedUrl);
      if (!data?.index_size || data.index_size !== data.chunk_count) {
        throw new Error("The backend did not confirm that the transcript index was created.");
      }
      setVideo({
        videoId: data.video_id,
        url: submittedUrl,
        language: data.transcript_language,
        chunkCount: data.chunk_count,
      });
      setChat([]);
      setQuestion("");
      if (questionInputRef.current) questionInputRef.current.style.height = "auto";
      setShowNewVideo(false);
    } catch (error) {
      setVideo(null);
      setChat([]);
      setErrorMessage(`Unable to process this video: ${getErrorMessage(error)}`);
    } finally {
      setAction(null);
    }
  };

  const handleAsk = async (questionText = question) => {
    const prompt = questionText.trim();
    if (!video || !prompt || action !== null) return;

    setAction("asking");
    setErrorMessage("");
    try {
      const { data } = await askQuestion(prompt);
      setChat((previous) => [
        ...previous,
        { role: "user", text: prompt },
        {
          role: "assistant",
          text: data.answer || data.error || "The backend returned no answer.",
          grounded: data.grounded,
        },
      ]);
      setQuestion("");
      if (questionInputRef.current) questionInputRef.current.style.height = "auto";
    } catch (error) {
      setChat((previous) => [
        ...previous,
        { role: "user", text: prompt },
        { role: "assistant", text: `Unable to generate an answer: ${getErrorMessage(error)}`, isError: true },
      ]);
      setQuestion("");
      if (questionInputRef.current) questionInputRef.current.style.height = "auto";
    } finally {
      setAction(null);
    }
  };

  return (
    <div className={`app-shell theme-${theme}`}>
      <Header theme={theme} onToggleTheme={() => setTheme((current) => current === "dark" ? "light" : "dark")} />
      {video ? (
        <ProcessedWorkspace
          video={video}
          question={question}
          setQuestion={setQuestion}
          chat={chat}
          action={action}
          onAsk={handleAsk}
          inputRef={questionInputRef}
          latestMessageRef={latestMessageRef}
          url={url}
          setUrl={setUrl}
          onProcess={handleProcess}
          showNewVideo={showNewVideo}
          setShowNewVideo={setShowNewVideo}
          errorMessage={errorMessage}
          clearError={() => setErrorMessage("")}
        />
      ) : (
        <LandingPage
          url={url}
          setUrl={setUrl}
          onProcess={handleProcess}
          action={action}
          errorMessage={errorMessage}
          clearError={() => setErrorMessage("")}
        />
      )}
      <footer className="site-footer"><span>YT RAG</span><span>Video understanding, kept simple.</span></footer>
    </div>
  );
}

export default App;
