import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Download,
  PawPrint,
  Printer,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import QRCode from "qrcode";
import type { HorseRecord } from "../App";
import { registerHorse as saveHorse } from "../lib/api";

type CameraState = "idle" | "starting" | "ready" | "denied";

interface RegisterProps {
  onRegistered: (horse: HorseRecord) => void;
  onViewDashboard: () => void;
}

function formatRegistrationDate(date: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function Register({ onRegistered, onViewDashboard }: RegisterProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [photo, setPhoto] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [normalTemperature, setNormalTemperature] = useState("37.2");
  const [registeredHorse, setRegisteredHorse] = useState<HorseRecord | null>(null);
  const [qrCode, setQrCode] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    stopCamera();
    setCameraState("starting");
    setPhoto("");
    setFormError("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState("ready");
    } catch {
      setCameraState("denied");
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    const scale = Math.min(1, 960 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext("2d");
    context?.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL("image/jpeg", 0.86));
    stopCamera();
    setCameraState("idle");
  };

  const resetRegistration = () => {
    stopCamera();
    setCameraState("idle");
    setPhoto("");
    setName("");
    setAge("");
    setNormalTemperature("37.2");
    setRegisteredHorse(null);
    setQrCode("");
    setFormError("");
  };

  const registerHorse = async (event: FormEvent) => {
    event.preventDefault();
    const parsedAge = Number(age);
    const parsedTemperature = Number(normalTemperature);

    if (!photo) {
      setFormError("Take a clear real-time camera photo before registering.");
      return;
    }

    if (!name.trim() || parsedAge < 1 || parsedTemperature < 35 || parsedTemperature > 40) {
      setFormError("Enter a name, valid age, and normal temperature between 35–40°C.");
      return;
    }

    setSaving(true);
    setFormError("");
    let horse: HorseRecord;
    try {
      // Upload the photo to Supabase Storage and save the horse in the database
      const saved = await saveHorse({
        name: name.trim(),
        age: parsedAge,
        normal_temp: parsedTemperature,
        photoDataUrl: photo,
      });
      horse = {
        id: saved.id,
        horseCode: saved.horse_code,
        name: saved.name,
        age: saved.age,
        normalTemperature: Number(saved.normal_temp),
        currentTemperature: null,
        envTemperature: null,
        status: "normal",
        registeredAt: saved.registered_at,
        lastUpdated: null,
        photo,
        openAlerts: 0,
      };
    } catch (error) {
      setFormError(`Could not save to the database: ${(error as Error).message}`);
      setSaving(false);
      return;
    }

    const qrPayload = JSON.stringify({
      system: "Horse Thermal Monitor",
      horseId: horse.horseCode,
      horseName: horse.name,
      registeredAt: horse.registeredAt,
    });

    const generatedQr = await QRCode.toDataURL(qrPayload, {
      width: 520,
      margin: 2,
      errorCorrectionLevel: "H",
      color: {
        dark: "#173B2A",
        light: "#FFFFFF",
      },
    });

    setRegisteredHorse(horse);
    setQrCode(generatedQr);
    setFormError("");
    setSaving(false);
    onRegistered(horse);
  };

  const downloadQr = () => {
    if (!qrCode || !registeredHorse) return;
    const link = document.createElement("a");
    link.download = `${registeredHorse.name.replace(/\s+/g, "-").toLowerCase()}-horse-qr.png`;
    link.href = qrCode;
    link.click();
  };

  if (registeredHorse) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border-2 border-green-200 bg-white">
          <div className="flex flex-col gap-4 bg-green-600 px-6 py-6 text-white sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
                <Check className="h-8 w-8" strokeWidth={3} />
              </div>
              <div>
                <p className="text-lg font-semibold text-green-50">Registration complete</p>
                <h1 className="text-3xl font-semibold sm:text-4xl">{registeredHorse.name} is registered</h1>
              </div>
            </div>
            <div className="rounded-lg bg-green-800/40 px-4 py-2 font-mono text-lg">
              {registeredHorse.horseCode}
            </div>
          </div>

          <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-8">
            <div className="space-y-6">
              <div className="overflow-hidden rounded-2xl border-2 border-gray-200 bg-gray-100">
                <img
                  src={photo}
                  alt={`Registration photo of ${registeredHorse.name}`}
                  className="aspect-[16/9] w-full object-cover"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-green-50 p-4">
                  <p className="text-sm font-semibold uppercase tracking-wide text-green-800">Age</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{registeredHorse.age} years</p>
                </div>
                <div className="rounded-xl bg-green-50 p-4">
                  <p className="text-sm font-semibold uppercase tracking-wide text-green-800">Normal temp</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">
                    {registeredHorse.normalTemperature.toFixed(1)}°C
                  </p>
                </div>
                <div className="col-span-2 rounded-xl bg-green-50 p-4 sm:col-span-1">
                  <p className="text-sm font-semibold uppercase tracking-wide text-green-800">Registered</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">
                    {formatRegistrationDate(registeredHorse.registeredAt)}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl border-2 border-green-200 bg-green-50 p-4 text-green-900">
                <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0" />
                <p className="text-lg">
                  This QR code is unique to {registeredHorse.name}. Attach it to the stall card or halter tag for quick identification.
                </p>
              </div>
            </div>

            <aside className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-green-300 bg-[#f8fcf8] p-6 text-center">
              <div className="mb-3 flex items-center gap-2 text-green-800">
                <QrCode className="h-6 w-6" />
                <span className="text-lg font-semibold">Horse ID QR Code</span>
              </div>
              <img
                src={qrCode}
                alt={`QR code for ${registeredHorse.name}`}
                className="w-full max-w-[280px] rounded-xl border border-gray-200 bg-white p-3"
              />
              <p className="mt-3 text-base text-gray-600">Scan to verify horse identity</p>
              <div className="mt-6 grid w-full gap-3">
                <button
                  type="button"
                  onClick={downloadQr}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-lg font-semibold text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-4 focus:ring-green-200"
                >
                  <Download className="h-5 w-5" />
                  Download QR
                </button>
                <button
                  type="button"
                  onClick={onViewDashboard}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-800 px-5 py-3 text-lg font-semibold text-white transition-colors hover:bg-green-900"
                >
                  View on Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 border-gray-300 bg-white px-5 py-3 text-lg font-semibold text-gray-800 transition-colors hover:bg-gray-100"
                >
                  <Printer className="h-5 w-5" />
                  Print Card
                </button>
                <button
                  type="button"
                  onClick={resetRegistration}
                  className="mt-2 text-lg font-semibold text-green-700 underline decoration-2 underline-offset-4 hover:text-green-900"
                >
                  Register another horse
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 font-semibold uppercase tracking-wider text-green-700">
            <PawPrint className="h-5 w-5" />
            Horse profile manager
          </div>
          <h1 className="text-4xl font-semibold text-gray-900">Register a horse</h1>
          <p className="mt-2 text-xl text-gray-600">Take a clear photo, add the details, then create a unique QR tag.</p>
        </div>
        <div className="mt-2 flex items-center gap-2 text-base font-semibold text-gray-500">
          <span className="rounded-full bg-green-600 px-3 py-1 text-white">1</span>
          Capture
          <span className="h-px w-5 bg-gray-300" />
          <span className="rounded-full bg-gray-200 px-3 py-1">2</span>
          Details
          <span className="h-px w-5 bg-gray-300" />
          <span className="rounded-full bg-gray-200 px-3 py-1">3</span>
          QR
        </div>
      </div>

      <form onSubmit={registerHorse} className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <section className="overflow-hidden rounded-2xl border-2 border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b-2 border-gray-100 px-5 py-4">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Horse photo</h2>
              <p className="text-base text-gray-500">Keep the horse centered and well lit</p>
            </div>
            <Camera className="h-7 w-7 text-green-600" />
          </div>

          <div className="p-4 sm:p-5">
            <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl bg-[#173b2a]">
              {photo ? (
                <img src={photo} alt="Captured horse preview" className="h-full w-full object-cover" />
              ) : (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className={`h-full w-full object-cover ${cameraState === "ready" ? "block" : "hidden"}`}
                  />
                  {cameraState !== "ready" && (
                    <div className="max-w-md px-6 text-center text-white">
                      <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
                        <Camera className="h-10 w-10" />
                      </div>
                      <p className="text-2xl font-semibold">
                        {cameraState === "starting" ? "Starting camera…" : cameraState === "denied" ? "Camera unavailable" : "Ready for a photo"}
                      </p>
                      <p className="mt-2 text-lg text-green-100">
                        {cameraState === "denied"
                          ? "Allow camera access in your browser settings, then try again."
                          : "Use the device camera to identify this horse."}
                      </p>
                    </div>
                  )}
                </>
              )}

              {cameraState === "ready" && !photo && (
                <div className="pointer-events-none absolute inset-6 rounded-[45%] border-2 border-dashed border-white/70" />
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            <div className="mt-4">
              {!photo && cameraState !== "ready" && (
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={cameraState === "starting"}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-xl font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-wait disabled:opacity-70"
                >
                  <Camera className="h-6 w-6" />
                  {cameraState === "starting" ? "Opening…" : "Open Camera"}
                </button>
              )}

              {cameraState === "ready" && !photo && (
                <button
                  type="button"
                  onClick={capturePhoto}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-xl font-semibold text-white hover:bg-green-700"
                >
                  <Camera className="h-6 w-6" />
                  Take Photo
                </button>
              )}

              {photo && (
                <button
                  type="button"
                  onClick={startCamera}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-gray-800 px-5 py-3 text-xl font-semibold text-white hover:bg-gray-900"
                >
                  <RefreshCw className="h-6 w-6" />
                  Retake Photo
                </button>
              )}

            </div>
          </div>
        </section>

        <section className="rounded-2xl border-2 border-gray-200 bg-white p-5 sm:p-6">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-gray-900">Horse details</h2>
            <p className="text-base text-gray-500">Used for monitoring and QR identification</p>
          </div>

          <div className="space-y-5">
            <div>
              <label htmlFor="horseName" className="mb-2 block text-lg font-semibold text-gray-800">Horse name</label>
              <input
                id="horseName"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Meadow"
                className="min-h-14 w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-xl outline-none transition-colors focus:border-green-600 focus:ring-4 focus:ring-green-100"
              />
            </div>

            <div>
              <label htmlFor="horseAge" className="mb-2 block text-lg font-semibold text-gray-800">Age (years)</label>
              <input
                id="horseAge"
                type="number"
                min="1"
                max="40"
                value={age}
                onChange={(event) => setAge(event.target.value)}
                placeholder="e.g. 6"
                className="min-h-14 w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-xl outline-none transition-colors focus:border-green-600 focus:ring-4 focus:ring-green-100"
              />
            </div>

            <div>
              <label htmlFor="normalTemp" className="mb-2 block text-lg font-semibold text-gray-800">Normal temperature (°C)</label>
              <input
                id="normalTemp"
                type="number"
                min="35"
                max="40"
                step="0.1"
                value={normalTemperature}
                onChange={(event) => setNormalTemperature(event.target.value)}
                className="min-h-14 w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-xl outline-none transition-colors focus:border-green-600 focus:ring-4 focus:ring-green-100"
              />
            </div>

            {formError && (
              <div role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-base font-semibold text-red-800">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="disabled:cursor-wait disabled:opacity-70 flex min-h-16 w-full items-center justify-center gap-3 rounded-xl bg-green-600 px-6 py-4 text-xl font-semibold text-white transition-colors hover:bg-green-700 focus:outline-none focus:ring-4 focus:ring-green-200"
            >
              <QrCode className="h-7 w-7" />
              {saving ? "Saving…" : "Register & Generate QR"}
            </button>

            <p className="text-center text-sm leading-relaxed text-gray-500">
              Horse details and photo are saved to the online database. The QR code contains the horse ID the thermal camera scans.
            </p>
          </div>
        </section>
      </form>
    </div>
  );
}
