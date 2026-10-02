import { redirect } from "next/navigation";

/** Lien court à partager (app.manaresto.com/demo) : ouvre directement le restaurant exemple, sans inscription. */
export default function DemoLinkPage() {
  redirect("/login?demo=1");
}
