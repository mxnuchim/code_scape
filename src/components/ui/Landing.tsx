"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseRepoUrl, type RepoUrlErrorKind } from "@/lib/github/parseRepoUrl";
import { loadRepo, SAMPLE_REPOS } from "@/state/loader";
import { useCity } from "@/state/store";
import { BrandMark, IconArrowRight, IconGitHub, IconHelp } from "./icons";
import { EnvironmentControl } from "./EnvironmentControl";

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
      <header className="flex items-start justify-between gap-2 p-3 sm:p-5">
        <div className="glass pointer-events-auto flex h-10 items-center gap-2 rounded-lg px-3 text-ink">
          <BrandMark size={20} />
          <span className="text-[14px] font-semibold tracking-tight">CodeScape</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <EnvironmentControl />
          </div>
          <div className="sm:hidden">
            <EnvironmentControl compact />
          </div>
          <button
            type="button"
            className="glass icon-btn pointer-events-auto h-10 w-10 rounded-lg"
            onClick={() => useCity.setState({ panel: "help" })}
            aria-label="How CodeScape works"
            title="How it works"
          >
            <IconHelp size={17} />
          </button>
        </div>
      </header>

      <div className="flex-1" />

      <motion.section
        className="pointer-events-auto w-full px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:max-w-[560px] sm:px-0 sm:pb-[6vh] sm:pl-[5vw]"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { delay: 0.25, duration: 0.5, ease: [0.2, 0.8, 0.2, 1] } }}
        exit={{ y: 16, opacity: 0, transition: { duration: 0.25 } }}
      >
        <div className="glass-strong rounded-xl p-4 sm:p-5">
          <p className="eyebrow mb-2">Code understanding · architecture map</p>
          <h1 className="text-[24px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink sm:text-[30px]">
            Understand any codebase. Find your way around.
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            Paste a public GitHub repository. Folders become districts and files become buildings. Imports and calls parsed from the source
            become arcs, and code journeys follow a request from its entry point. Every claim links back to a file and line.
          </p>

          <form onSubmit={onSubmit} className="mt-4" noValidate>
            <div key={shakeKey} className={`flex items-center gap-2 ${shakeKey ? "shake" : ""}`}>
              <label
                htmlFor="repo-url"
                className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-white/10 bg-black/30 px-3 focus-within:border-accent/70"
              >
                <IconGitHub size={16} className="shrink-0 text-ink-soft" />
                <input
                  ref={inputRef}
                  id="repo-url"
                  type="text"
                  aria-label="GitHub repository URL"
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
                  className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-ink-faint"
                />
              </label>
              <button type="submit" className="btn btn-primary h-10 shrink-0 px-4 text-[13px]">
                Build
                <IconArrowRight size={15} />
              </button>
            </div>
            <div className="pt-2">
              {errorMessage ? (
                <p id="repo-url-error" role="alert" className="text-[12px] text-orange-300">
                  {errorMessage}
                </p>
              ) : (
                <p id="repo-url-hint" className="text-[12px] text-ink-faint">
                  Public repositories. For private or local code, run <code className="font-mono text-ink-soft">codescape view --root .</code> or use
                  CodeScape from Claude Code.
                </p>
              )}
            </div>
          </form>

          <div className="mt-4 border-t border-white/[0.07] pt-3">
            <p className="eyebrow mb-2">Examples</p>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 sm:flex-wrap sm:overflow-visible">
              {SAMPLE_REPOS.map((s) => (
                <button
                  key={`${s.owner}/${s.repo}`}
                  type="button"
                  className="chip shrink-0"
                  onClick={() => {
                    setText(`github.com/${s.owner}/${s.repo}`);
                    void loadRepo({ owner: s.owner, repo: s.repo });
                  }}
                >
                  <span className="font-mono text-[11.5px]">
                    {s.owner}/{s.repo}
                  </span>
                  <span className="text-[11px] text-ink-faint">{s.note}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="mt-3 font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">
            GitHub&apos;s public API · code is never executed · the town behind this card is illustrative
          </p>
        </div>
      </motion.section>
    </motion.div>
  );
}
