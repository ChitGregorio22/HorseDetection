import { FormEvent, useState } from "react";
import { Briefcase, HeartPulse, LogIn, Stethoscope, UserPlus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { LogoMark } from "./Brand";
import headerPhoto from "../../assets/horse-header.jpg";
import headerPhotoSmall from "../../assets/horse-header-sm.jpg";

type SignupRole = "owner" | "caretaker" | "veterinarian";

const SIGNUP_ROLES: { value: SignupRole; label: string; description: string; icon: typeof Briefcase }[] = [
  { value: "owner", label: "Owner", description: "Manage settings and horses", icon: Briefcase },
  { value: "caretaker", label: "Caretaker", description: "Monitor horses and alerts", icon: HeartPulse },
  { value: "veterinarian", label: "Veterinarian", description: "Monitor horses and alerts", icon: Stethoscope },
];

export function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<SignupRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "signup" && !role) {
      setMessage({ kind: "error", text: "Choose your role: Owner, Caretaker or Veterinarian." });
      return;
    }
    setBusy(true);
    setMessage(null);

    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName.trim(), role } } });

    setBusy(false);
    if (result.error) {
      setMessage({ kind: "error", text: result.error.message });
    } else if (mode === "signup" && !result.data.session) {
      setMessage({ kind: "info", text: "Account created. Check your email to confirm, then sign in. An admin will approve your account." });
      setMode("signin");
    }
  };

  const inputClass =
    "min-h-14 w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-xl outline-none focus:border-green-600 focus:ring-4 focus:ring-green-100";

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-green-900 p-4">
      <img
        src={headerPhotoSmall}
        srcSet={`${headerPhotoSmall} 900w, ${headerPhoto} 1600w`}
        sizes="100vw"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-[center_62%]"
      />
      <div className="pointer-events-none absolute inset-0 bg-green-950/55" />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-2xl">
        <div className="flex flex-col items-center bg-green-700 px-6 py-6 text-center text-white">
          <div className="mb-3 rounded-2xl bg-white p-1.5 shadow-md">
            <LogoMark className="h-24 w-24" />
          </div>
          <h1 className="text-3xl">Horse Thermal Monitor</h1>
          <p className="mt-1 text-lg">{mode === "signin" ? "Sign in to continue" : "Create an account"}</p>
        </div>

        <form onSubmit={submit} className="space-y-5 p-4 sm:p-6">
          {mode === "signup" && (
            <div>
              <label htmlFor="fullName" className="mb-2 block text-lg font-semibold">Full name</label>
              <input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required className={inputClass} />
            </div>
          )}

          {mode === "signup" && (
            <fieldset>
              <legend className="mb-2 block text-lg font-semibold">I am a…</legend>
              <div className="grid grid-cols-1 gap-2">
                {SIGNUP_ROLES.map((option) => {
                  const Icon = option.icon;
                  const selected = role === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 ${
                        selected ? "border-green-600 bg-green-50 ring-4 ring-green-100" : "border-gray-300 bg-white hover:border-green-400"
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        value={option.value}
                        checked={selected}
                        onChange={() => {
                          setRole(option.value);
                          setMessage(null);
                        }}
                        className="h-5 w-5 accent-green-600"
                      />
                      <Icon className={`h-7 w-7 ${selected ? "text-green-700" : "text-gray-500"}`} />
                      <span>
                        <span className="block text-xl">{option.label}</span>
                        <span className="block text-base text-gray-600">{option.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-base text-gray-600">An admin approves every new account before it can be used.</p>
            </fieldset>
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
