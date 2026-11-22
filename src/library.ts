export type Theme = 'system' | 'light' | 'dark'

export interface Folder {
  id: string
  name: string
  color: 'mint' | 'blue' | 'peach'
}

export interface LibraryFile {
  id: string
  name: string
  folderId: string | null
  addedAt: number
  favorite: boolean
  content: Blob
}

export interface RemoteDisplayFile extends Omit<LibraryFile, 'content'> {
  mime: string
  bytes?: number
}

export type DisplayFile = LibraryFile | RemoteDisplayFile

export function displaySize(file: DisplayFile) {
  const bytes = 'content' in file ? file.content.size : file.bytes
  return bytes === undefined ? '—' : formatSize(bytes)
}

export interface Library {
  files: LibraryFile[]
  folders: Folder[]
  theme: Theme
}

const colorOptions: Folder['color'][] = ['mint', 'blue', 'peach']

export function makeFolder(name: string, count: number): Folder {
  return { id: crypto.randomUUID(), name, color: colorOptions[count % colorOptions.length] }
}

export function formatSize(bytes: number) {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let index = 0
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000
    index++
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${units[index]}`
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
export const formatDate = (time: number) => dateFormatter.format(time)

export function fileKind(file: DisplayFile) {
  const mime = 'content' in file ? file.content.type : file.mime
  if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime)) return 'image'
  if (/^video\/(mp4|webm|ogg|quicktime|x-m4v)$/.test(mime)) return 'video'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'text/csv' || /\.csv$/i.test(file.name)) return 'sheet'
  if (mime.startsWith('text/')) return 'text'
  return 'other'
}

export function isMedia(file: DisplayFile) {
  const kind = fileKind(file)
  return kind === 'image' || kind === 'video'
}

function samplePdf() {
  const pageText = 'BT /F1 28 Tf 72 716 Td (Launch checklist) Tj /F1 13 Tf 0 -48 Td (1. Review the file library.) Tj 0 -26 Td (2. Check file previews and downloads.) Tj 0 -26 Td (3. Confirm everything persists after reload.) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${pageText.length} >>\nstream\n${pageText}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = ['0000000000 65535 f \n']
  objects.forEach((object, index) => {
    offsets.push(`${String(pdf.length).padStart(10, '0')} 00000 n \n`)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${offsets.length}\n${offsets.join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Blob([pdf], { type: 'application/pdf' })
}

const demoPhotos = [
  ['dolomites.jpg', 'Dolomites.jpg', 'sample-mountains'],
  ['rocky-shore.jpg', 'Rocky shore.jpg', 'sample-coast'],
  ['sand-dunes.jpg', 'Sand dunes.jpg', 'sample-desert'],
  ['lake-boats.jpg', 'Lakeside boats.jpg', 'sample-mountains'],
  ['golden-waves.jpg', 'Golden waves.jpg', 'sample-coast'],
  ['alpine-autumn.jpg', 'Alpine autumn.jpg', 'sample-mountains'],
  ['desert-ridges.jpg', 'Desert ridges.jpg', 'sample-desert'],
] as const

export async function sampleLibrary(): Promise<Library> {
  const folders: Folder[] = [
    { id: 'sample-mountains', name: 'Into the mountains', color: 'mint' },
    { id: 'sample-coast', name: 'By the coast', color: 'blue' },
    { id: 'sample-desert', name: 'Desert light', color: 'peach' },
    { id: 'sample-docs', name: 'Documents', color: 'blue' },
  ]
  const now = Date.now()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const makeFile = (id: string, name: string, folderId: string | null, content: Blob, daysAgo: number, favorite = false): LibraryFile => ({
    id, name, folderId, content, addedAt: daysAgo ? yesterday.getTime() : now, favorite,
  })
  const photos = await Promise.allSettled(demoPhotos.map(async ([asset, name, folder], index) => {
    const response = await fetch(`${import.meta.env.BASE_URL}demo/${asset}`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Sample photo unavailable.')
    return makeFile(`demo-${asset}`, name, folder, await response.blob(), index < 4 ? 0 : 1, index === 0 || index === 4)
  }))
  const files = [
    ...photos.flatMap((photo) => photo.status === 'fulfilled' ? [photo.value] : []),
    makeFile('sample-checklist', 'Launch checklist.pdf', 'sample-docs', samplePdf(), 0),
    makeFile('sample-notes', 'Trip notes.txt', null, new Blob(['Trip notes\n\nSave the places you want to visit again.'], { type: 'text/plain' }), 1),
  ]
  return { files, folders, theme: 'system' }
}
