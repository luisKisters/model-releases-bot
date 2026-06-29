import { Dashboard } from "@/components/dashboard";

export default function Page() {
  return <Dashboard convexConfigured={Boolean(process.env.NEXT_PUBLIC_CONVEX_URL)} />;
}
