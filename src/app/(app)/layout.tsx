import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import Shell from "@/components/Shell";
import { UserProvider } from "@/components/UserProvider";

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
