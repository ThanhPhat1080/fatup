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
  image: { icon: FileImage, tone: 'red' },
  pdf: { icon: FileText, tone: 'red' },
  doc: { icon: FileText, tone: 'blue' },
  sheet: { icon: FileSpreadsheet, tone: 'green' },
  slide: { icon: Presentation, tone: 'yellow' },
  archive: { icon: FileArchive, tone: 'gray' },
  video: { icon: FileVideo, tone: 'red' },
  audio: { icon: FileAudio, tone: 'purple' },
  text: { icon: FileText, tone: 'gray' },
  other: { icon: File, tone: 'gray' },
};

/** The red file with a small "PDF" band across it, so a PDF is told apart from other documents at a glance. */
function PdfIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="file-icon tone-red" aria-hidden>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <rect x="1" y="11" width="17" height="8.5" rx="1.6" fill="currentColor" />
      <text x="9.5" y="17.6" textAnchor="middle" fontSize="6.6" fontWeight="800" fontFamily="system-ui, sans-serif" fill="#fff" letterSpacing="0.2">
        PDF
      </text>
    </svg>
  );
}

export function FileIcon({ name, mime, size = 20 }: { name: string; mime: string; size?: number }) {
  const visual = fileVisual(name, mime);
  if (visual === 'pdf') return <PdfIcon size={size} />;
  const { icon: Icon, tone } = ICONS[visual];
  return <Icon size={size} className={`file-icon tone-${tone}`} aria-hidden />;
}
