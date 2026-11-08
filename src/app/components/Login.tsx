import { FormEvent, useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { supabase } from "../lib/supabase";

export function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });

    setBusy(false);
    if (result.error) {
      setMessage({ kind: "error", text: result.error.message });
    } else if (mode === "signup" && !result.data.session) {
      setMessage({ kind: "info", text: "Account created. Check your email to confirm, then sign in." });
      setMode("signin");
    }
  };

  const inputClass =
    "min-h-14 w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-xl outline-none focus:border-green-600 focus:ring-4 focus:ring-green-100";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-gray-200 bg-white">
        <div className="bg-green-600 px-6 py-6 text-white">
          <h1 className="text-3xl">🐎 Horse Thermal Monitor</h1>
          <p className="mt-1 text-lg">{mode === "signin" ? "Sign in to continue" : "Create an account"}</p>
        </div>

        <form onSubmit={submit} className="space-y-5 p-6">
          {mode === "signup" && (
            <div>
              <label htmlFor="fullName" className="mb-2 block text-lg font-semibold">Full name</label>
              <input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required className={inputClass} />
            </div>
          )}
          <div>
            <label htmlFor="email" className="mb-2 block text-lg font-semibold">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label htmlFor="password" className="mb-2 block text-lg font-semibold">Password</label>
            <input
              id="password"
              type="password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={inputClass}
            />
          </div>

          {message && (
            <div
              role="alert"
              className={`rounded-xl border-2 p-4 text-base font-semibold ${
                message.kind === "error" ? "border-red-300 bg-red-50 text-red-800" : "border-green-300 bg-green-50 text-green-800"
              }`}
            >
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-6 py-3 text-xl font-semibold text-white hover:bg-green-700 disabled:opacity-70"
          >
            {mode === "signin" ? <LogIn className="h-6 w-6" /> : <UserPlus className="h-6 w-6" />}
            {busy ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMessage(null);
            }}
            className="w-full text-lg font-semibold text-green-700 underline underline-offset-4"
          >
            {mode === "signin" ? "No account yet? Sign up" : "Already have an account? Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
