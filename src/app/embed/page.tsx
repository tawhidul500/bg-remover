import type { Metadata } from "next";
import EditorLoader from "@/components/editor/EditorLoader";
import { APP_NAME } from "@/lib/config";

export const metadata: Metadata = { title: APP_NAME, robots: { index: false } };

/** Chrome-less editor for embedding inside the WordPress page via the Cutout Studio plugin iframe. */
export default function EmbedPage() {
  return <EditorLoader embedded />;
}
