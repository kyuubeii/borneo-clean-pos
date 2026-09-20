import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import { UserProvider } from "@/components/UserProvider";

/**
 * Run next to the database.
 *
 * The database lives in ap-southeast-1. Vercel's project default is iad1, which
 * put every query on a round trip across the Pacific; vercel.json pins the same
 * region, and this keeps it pinned even if that project setting is changed.
 */
export const preferredRegion = "sin1";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const current = { id: user.id, name: user.name, role: user.role, staffId: user.staffId ?? null };
  return (
    <UserProvider user={current}>
      <Shell user={current}>{children}</Shell>
    </UserProvider>
  );
}
