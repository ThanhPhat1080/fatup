import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import { fileVisual, type FileVisual } from '../lib/format';

const ICONS: Record<FileVisual, { icon: LucideIcon; tone: string }> = {
  image: { icon: FileImage, tone: 'teal' },
  pdf: { icon: FileText, tone: 'red' },
  doc: { icon: FileText, tone: 'blue' },
  sheet: { icon: FileSpreadsheet, tone: 'green' },
  slide: { icon: Presentation, tone: 'yellow' },
  archive: { icon: FileArchive, tone: 'gray' },
  video: { icon: FileVideo, tone: 'pink' },
  audio: { icon: FileAudio, tone: 'purple' },
  markdown: { icon: FileText, tone: 'blue' },
  html: { icon: FileText, tone: 'yellow' },
  txt: { icon: FileText, tone: 'gray' },
  text: { icon: FileText, tone: 'gray' },
  other: { icon: File, tone: 'gray' },
};

/** Visuals drawn as a file with a coloured band across it (like the PDF one), carrying the file type in letters. */
const BADGES: Partial<Record<FileVisual, { label: string; tone: string; fontSize: number }>> = {
  pdf: { label: 'PDF', tone: 'red', fontSize: 6.6 },
  markdown: { label: 'MD', tone: 'blue', fontSize: 7.2 },
  html: { label: 'HTML', tone: 'yellow', fontSize: 4.7 },
  txt: { label: 'TXT', tone: 'gray', fontSize: 6.6 },
};

/** A file with a small band across it that says what it is (PDF, MD, HTML, TXT), so these are told apart from other documents at a glance. */
function BadgeIcon({ label, tone, fontSize, size }: { label: string; tone: string; fontSize: number; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`file-icon tone-${tone}`} aria-hidden>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <rect x="1" y="11" width="17" height="8.5" rx="1.6" fill="currentColor" />
      <text x="9.5" y="17.6" textAnchor="middle" fontSize={fontSize} fontWeight="800" fontFamily="system-ui, sans-serif" fill="#fff" letterSpacing="0.2">
        {label}
      </text>
    </svg>
  );
}

export function FileIcon({ name, mime, size = 20 }: { name: string; mime: string; size?: number }) {
  const visual = fileVisual(name, mime);
  const badge = BADGES[visual];
  if (badge) return <BadgeIcon {...badge} size={size} />;
  const { icon: Icon, tone } = ICONS[visual];
  return <Icon size={size} className={`file-icon tone-${tone}`} aria-hidden />;
}
