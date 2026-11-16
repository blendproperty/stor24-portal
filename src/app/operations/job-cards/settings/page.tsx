import { ChangePasswordForm } from "@/components/change-password-form";
import { MfaSettings } from "@/components/mfa-settings";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Account security" };

export default function JobCardSettingsPage() {
  return <div className="page-stack" data-guide="job-card-settings">
    <PageHeader eyebrow="Personal" title="Account security" description="Manage your password and two-step verification." />
    <section className="panel panel-spacious"><h2>Two-step verification</h2><MfaSettings /></section>
    <section className="panel panel-spacious"><h2>Account password</h2><ChangePasswordForm /></section>
  </div>;
}
