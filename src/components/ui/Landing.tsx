"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseRepoUrl, type RepoUrlErrorKind } from "@/lib/github/parseRepoUrl";
import { loadRepo, SAMPLE_REPOS } from "@/state/loader";
import { useCity } from "@/state/store";
import { BrandMark, IconArrowRight, IconGitHub, IconHelp, IconSparkle } from "./icons";

const ERROR_COPY: Record<RepoUrlErrorKind, (detail?: string) => string> = {
  empty: () => "Paste a GitHub repository link to start building.",
  "not-github": (host) =>
    `CodeScape reads repositories from GitHub${host ? `, and that link points to ${host}` : ""}. Try a github.com link.`,
  "profile-only": (owner) => `That's ${owner ? `${owner}'s` : "a"} profile. Add a repository name, like ${owner ?? "owner"}/repository.`,
  "reserved-path": () => "That's a GitHub page, not a repository. Try a link like github.com/owner/repository.",
  malformed: (detail) => detail ?? "That doesn't look like a repository link. Try github.com/owner/repository.",
};

export function Landing() {
  const inputError = useCity((s) => s.inputError);
  const [text, setText] = useState(inputError?.text ?? "");
  const [shakeKey, setShakeKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const pasteTimer = useRef<number | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 500);
    return () => {
      window.clearTimeout(t);
      if (pasteTimer.current) window.clearTimeout(pasteTimer.current);
    };
  }, []);

  const submit = (value: string) => {
    const parsed = parseRepoUrl(value);
    if (!parsed.ok) {
      useCity.setState({ inputError: { kind: parsed.error, detail: parsed.detail, text: value } });
      setShakeKey((k) => k + 1);
      inputRef.current?.focus();
      return;
    }
    useCity.setState({ inputError: null });
    void loadRepo(parsed.value);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(text);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    const parsed = parseRepoUrl(pasted);
    if (!parsed.ok) return;
    // A valid link was pasted: start right away, after a beat so the field visibly fills.
    if (pasteTimer.current) window.clearTimeout(pasteTimer.current);
    pasteTimer.current = window.setTimeout(() => submit(pasted), 420);
  };

  const errorMessage = inputError ? ERROR_COPY[inputError.kind](inputError.detail) : null;

  return (
    <motion.div
      className="absolute inset-0 flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
    >
      <header className="flex items-center justify-between p-4 sm:p-6">
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-full py-1.5 pr-4 pl-1.5 glass">
          <BrandMark size={30} />
          <span className="font-display text-[1.05rem] font-bold tracking-tight">CodeScape</span>
        </div>
        <button
          type="button"
          className="btn btn-quiet pointer-events-auto px-3.5 py-2 text-sm glass"
          onClick={() => useCity.setState({ panel: "help" })}
        >
          <IconHelp size={16} />
          <span className="hidden sm:inline">How it works</span>
        </button>
      </header>

      <div className="flex-1" />

      <motion.section
        className="pointer-events-auto mx-auto w-full max-w-[640px] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-[7vh]"
        initial={{ y: 28, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { delay: 0.25, type: "spring", stiffness: 140, damping: 20 } }}
        exit={{ y: 24, opacity: 0, scale: 0.98, transition: { duration: 0.3 } }}
      >
        <div className="mb-4 text-center sm:mb-5">
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/60 px-3 py-1 text-[0.72rem] font-semibold tracking-wide text-ink-soft uppercase backdrop-blur-sm">
            <IconSparkle size={13} /> A city for every codebase
          </p>
          <h1 className="font-display text-[2rem] leading-[1.02] font-extrabold tracking-[-0.03em] text-ink sm:text-[3.1rem]" style={{ textShadow: "0 2px 18px rgba(255,248,238,0.9)" }}>
            Turn any GitHub repo into a living miniature city
          </h1>
        </div>

        <form onSubmit={onSubmit} className="glass-strong rounded-[26px] p-2" noValidate>
          <div key={shakeKey} className={`flex items-center gap-2 ${shakeKey ? "shake" : ""}`}>
            <label htmlFor="repo-url" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[20px] bg-white/70 px-3.5 py-2.5 ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-accent/60">
              <IconGitHub size={20} className="shrink-0 text-ink" />
              <input
                ref={inputRef}
                id="repo-url"
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="github.com/owner/repository"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (inputError) useCity.setState({ inputError: null });
                }}
                onPaste={onPaste}
                aria-invalid={Boolean(inputError)}
                aria-describedby={inputError ? "repo-url-error" : "repo-url-hint"}
                className="min-w-0 flex-1 bg-transparent font-mono text-[0.95rem] text-ink outline-none placeholder:text-ink-faint"
              />
            </label>
            <button type="submit" className="btn btn-primary shrink-0 px-4 py-3 text-[0.95rem] sm:px-5">
              <span className="hidden sm:inline">Build city</span>
              <IconArrowRight size={18} />
            </button>
          </div>
          <div className="px-3 pt-2 pb-1">
            {errorMessage ? (
              <p id="repo-url-error" role="alert" className="text-[0.82rem] font-medium text-[#b4461f]">
                {errorMessage}
              </p>
            ) : (
              <p id="repo-url-hint" className="text-[0.78rem] text-ink-faint">
                Public repositories only. Pasting a link starts building right away.
              </p>
            )}
          </div>
        </form>

        <div className="mt-3 flex flex-col items-center gap-2 sm:mt-4">
          <div className="flex w-full items-center gap-2 overflow-x-auto px-1 pb-1 sm:justify-center sm:overflow-visible">
            <span className="shrink-0 text-[0.78rem] font-semibold text-ink-soft">Try</span>
            {SAMPLE_REPOS.map((s, i) => (
              <button
                key={`${s.owner}/${s.repo}`}
                type="button"
                className={`chip shrink-0 ${i === 0 ? "border-accent/30 bg-white" : ""}`}
                onClick={() => {
                  setText(`github.com/${s.owner}/${s.repo}`);
                  void loadRepo({ owner: s.owner, repo: s.repo });
                }}
              >
                <IconGitHub size={13} />
                <span className="font-semibold">
                  {s.owner}/{s.repo}
                </span>
                <span className="text-ink-faint">{s.note}</span>
              </button>
            ))}
          </div>
          <p className="text-center text-[0.72rem] text-ink-soft/90">
            Reads the file tree through GitHub&apos;s public API. Repository code is never run.
          </p>
        </div>
      </motion.section>
    </motion.div>
  );
}
