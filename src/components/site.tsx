"use client";
import Link from "next/link";
import { APP_NAME, PARENT_SITE_NAME, PARENT_SITE_URL } from "@/lib/config";

const LOGO = process.env.NEXT_PUBLIC_LOGO_URL || `${PARENT_SITE_URL}/mygykroo/2024/02/clipping-world-logo.webp`;

/**
 * Minimal header: logo only. The surrounding WordPress theme supplies the site navigation,
 * so a second menu here would duplicate it.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-line-soft bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-full max-w-7xl items-center px-4">
        <Link href="/" className="flex items-center" aria-label={`${PARENT_SITE_NAME} home`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} alt={`${PARENT_SITE_NAME} logo`} width={150} height={50} className="h-10 w-auto" />
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-ink-2 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-3">
        <div>
          <p className="text-lg font-semibold text-white">{PARENT_SITE_NAME}</p>
          <p className="mt-2 text-sm">Need hand-finished results? Our editors offer clipping path, masking, retouching and shadow services.</p>
        </div>
        <div>
          <p className="font-semibold text-white">Useful links</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li><a className="hover:text-white" href={`${PARENT_SITE_URL}/background-removing-services/`}>Background removal service</a></li>
            <li><a className="hover:text-white" href={`${PARENT_SITE_URL}/clipping-path-services/`}>Clipping path service</a></li>
            <li><a className="hover:text-white" href={`${PARENT_SITE_URL}/price-list/`}>Price list</a></li>
            <li><a className="hover:text-white" href={`${PARENT_SITE_URL}/privacy-policy/`}>Privacy policy</a></li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-white">Contact</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            <li><a className="hover:text-white" href="mailto:info@clippingworld.com">info@clippingworld.com</a></li>
            <li><a className="hover:text-white" href={`${PARENT_SITE_URL}/contact-us/`}>Contact us</a></li>
            <li><Link className="hover:text-white" href="/help">{APP_NAME} help &amp; privacy</Link></li>
          </ul>
        </div>
      </div>
      <p className="border-t border-white/10 py-4 text-center text-xs text-slate-400">© {new Date().getFullYear()} {PARENT_SITE_NAME}. {APP_NAME} runs in your browser.</p>
    </footer>
  );
}
