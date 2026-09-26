import type { Metadata } from "next";
import EditorLoader from "@/components/editor/EditorLoader";
import { SiteHeader } from "@/components/site";
import { APP_NAME } from "@/lib/config";

export const metadata: Metadata = { title: `Editor – ${APP_NAME}` };

export default function EditorPage() {
  return (
    <>
      <SiteHeader />
      <EditorLoader />
    </>
  );
}
