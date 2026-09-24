import { AuthShell } from "../../AuthShell";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default async function ForgotPasswordPage({ searchParams }: PageProps<"/sign-in/forgot">) {
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email : "";
  const from = typeof params.from === "string" ? params.from : undefined;
  return (
    <AuthShell title="Reset your password" lede="We'll email you a link to choose a new one.">
      <ForgotPasswordForm initialEmail={email} from={from} />
    </AuthShell>
  );
}
