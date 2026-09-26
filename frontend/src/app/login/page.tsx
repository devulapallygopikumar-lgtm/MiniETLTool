"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@/app/lib/api";
import { useAuth } from "@/app/lib/auth-context";
import { Alert, Button, Card, CardBody, CardHeader, FormField } from "@/app/components/ui";

const inputClass = "rounded-md border border-border bg-surface px-2 py-1.5 text-sm";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      await login(email, password);
      router.push("/");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Login failed. Try again.");
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 pt-12">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-sm text-foreground-muted">Mini ETL</p>
      </div>

      <Card>
        <CardHeader title="Log in" />
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <FormField label="Email" required>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </FormField>
            <FormField label="Password" required>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </FormField>
            {error && <Alert>{error}</Alert>}
            <Button type="submit" disabled={status === "submitting"} className="mt-1">
              {status === "submitting" ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
