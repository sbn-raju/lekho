import { Alert, Box, Button, Card, FileButton, Group, Image, Modal, Slider, Stack, Text } from '@mantine/core';
import { upload } from '@imagekit/react';
import { IconCamera, IconPhotoOff, IconTrash, IconUpload, IconZoomIn } from '@tabler/icons-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { confirmAction, errorMessage, notifySuccess } from '@/components/feedback/feedback';
import { useSchoolMutation } from '@/services/api/school';
import { studentsApi } from '@/services/api/students';
import type { StudentSummary } from '@/types/students';
import { formatDateTime } from '@/utils/format';

const ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
/** Crop viewport (3:4) and exported size. */
const VIEW = { w: 240, h: 320 };
const OUT = { w: 600, h: 800 };

/**
 * Student photograph (FRD §5): choose → crop to 3:4 → upload straight to ImageKit with a one-time
 * signature from the backend → the backend verifies the file and stores it. Photos are private
 * and displayed through short-lived signed URLs.
 */
export function PhotoPanel({ student, canEdit }: { student: Pick<StudentSummary, 'id' | 'fullName' | 'photo' | 'archived'>; canEdit: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = useSchoolMutation(() => studentsApi.removePhoto(student.id));
  const resetRef = useRef<() => void>(null);
  const photo = student.photo;

  const choose = (f: File | null) => {
    resetRef.current?.();
    setError(null);
    if (!f) return;
    if (!ACCEPT.includes(f.type)) return setError('Choose a JPG, PNG or WebP image.');
    if (f.size > 20 * 1024 * 1024) return setError('That file is too large. Choose an image under 20 MB; it is resized before upload.');
    setFile(f);
  };

  return (
    <Card>
      <Group align="flex-start" gap="xl" wrap="wrap">
        <Box w={180} h={240} style={{ borderRadius: 'var(--mantine-radius-md)', overflow: 'hidden', background: 'var(--lekho-surface-muted, var(--mantine-color-gray-1))' }}>
          {photo?.url ? (
            <Image src={photo.url} alt={`Photo of ${student.fullName}`} w={180} h={240} fit="cover" />
          ) : (
            <Stack align="center" justify="center" h="100%" gap={4}>
              <IconPhotoOff size={32} stroke={1.5} color="var(--mantine-color-dimmed)" />
              <Text size="sm" c="dimmed">
                {photo ? 'Photo storage not configured' : 'No photo'}
              </Text>
            </Stack>
          )}
        </Box>
        <Stack gap="sm" maw={420}>
          <Text size="sm" c="dimmed">
            JPG, PNG or WebP, up to 5 MB. A 3:4 portrait at least 300 × 400 pixels works best. The photo is required for ID cards.
          </Text>
          {photo && (
            <Text size="sm">
              Version {photo.version} · uploaded {formatDateTime(photo.uploadedAt)}
              {photo.width && photo.height ? ` · ${photo.width} × ${photo.height}` : ''}
            </Text>
          )}
          {error && (
            <Alert color="error" variant="light">
              {error}
            </Alert>
          )}
          {canEdit && !student.archived && (
            <Group gap="sm">
              <FileButton resetRef={resetRef} onChange={choose} accept={ACCEPT.join(',')}>
                {(props) => (
                  <Button leftSection={photo ? <IconCamera size={16} /> : <IconUpload size={16} />} {...props}>
                    {photo ? 'Replace photo' : 'Upload photo'}
                  </Button>
                )}
              </FileButton>
              {photo && (
                <Button
                  variant="default"
                  color="error"
                  leftSection={<IconTrash size={16} />}
                  onClick={() =>
                    confirmAction({
                      title: 'Remove photo?',
                      message: 'The student will need a new photo before an ID card can be generated.',
                      confirmLabel: 'Remove',
                      destructive: true,
                      onConfirm: () => remove.mutateAsync(undefined),
                      successMessage: 'Photo removed',
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </Group>
          )}
        </Stack>
      </Group>
      {file && <CropUploadModal studentId={student.id} file={file} onClose={() => setFile(null)} />}
    </Card>
  );
}

function CropUploadModal({ studentId, file, onClose }: { studentId: string; file: File; onClose: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const save = useSchoolMutation((fileId: string) => studentsApi.savePhoto(studentId, fileId));

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      // Start centred: the image is scaled to just cover the frame.
      const s = Math.max(VIEW.w / image.naturalWidth, VIEW.h / image.naturalHeight);
      setPos({ x: (VIEW.w - image.naturalWidth * s) / 2, y: (VIEW.h - image.naturalHeight * s) / 2 });
      setImg(image);
      setSrc(url);
    };
    image.onerror = () => setError("That image couldn't be read. Try another file.");
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const base = img ? Math.max(VIEW.w / img.naturalWidth, VIEW.h / img.naturalHeight) : 1;
  const scale = base * zoom;
  const dw = img ? img.naturalWidth * scale : VIEW.w;
  const dh = img ? img.naturalHeight * scale : VIEW.h;
  const clamp = (p: { x: number; y: number }) => ({ x: Math.min(0, Math.max(VIEW.w - dw, p.x)), y: Math.min(0, Math.max(VIEW.h - dh, p.y)) });

  // Derived, so the image always covers the frame whatever the zoom.
  const at = clamp(pos);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: at.x, py: at.y };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
  };

  const crop = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = OUT.w;
      canvas.height = OUT.h;
      const ctx = canvas.getContext('2d');
      if (!ctx || !img) return reject(new Error('Cropping is not supported in this browser.'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, OUT.w, OUT.h);
      ctx.drawImage(img, -at.x / scale, -at.y / scale, VIEW.w / scale, VIEW.h / scale, 0, 0, OUT.w, OUT.h);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the photo.'))), 'image/jpeg', 0.9);
    });

  const submit = async () => {
    setError(null);
    setProgress(0);
    try {
      const blob = await crop();
      if (blob.size > MAX_BYTES) throw new Error('The cropped photo is larger than 5 MB. Try zooming in.');
      const auth = await studentsApi.photoAuth(studentId);
      const result = await upload({
        file: blob,
        fileName: `${auth.fileName}.jpg`,
        token: auth.token,
        expire: auth.expire,
        signature: auth.signature,
        publicKey: auth.publicKey,
        folder: auth.folder,
        isPrivateFile: auth.isPrivateFile,
        useUniqueFileName: auth.useUniqueFileName,
        onProgress: (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100)),
      });
      if (!result.fileId) throw new Error('The upload did not return a file id.');
      const saved = await save.mutateAsync(result.fileId);
      notifySuccess(saved.warnings[0] ?? 'Photo saved');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setProgress(null);
    }
  };

  return (
    <Modal opened onClose={onClose} title="Crop photo" size="auto">
      <Stack gap="md" align="center">
        <Text size="sm" c="dimmed">
          Drag to position the face in the frame; zoom to fit.
        </Text>
        <Box
          w={VIEW.w}
          h={VIEW.h}
          pos="relative"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
          style={{ overflow: 'hidden', borderRadius: 'var(--mantine-radius-md)', cursor: 'grab', touchAction: 'none', outline: '2px solid var(--mantine-color-lekho-5)' }}
          aria-label="Photo crop area"
        >
          {src && <img src={src} alt="" draggable={false} style={{ position: 'absolute', left: at.x, top: at.y, width: dw, height: dh, userSelect: 'none', pointerEvents: 'none' }} />}
        </Box>
        <Group w={VIEW.w} gap="xs" wrap="nowrap">
          <IconZoomIn size={18} stroke={1.75} aria-hidden />
          <Slider style={{ flex: 1 }} min={1} max={3} step={0.01} value={zoom} onChange={setZoom} label={null} aria-label="Zoom" />
        </Group>
        {error && (
          <Alert color="error" variant="light" w="100%">
            {error}
          </Alert>
        )}
        <Group justify="flex-end" w="100%">
          <Button variant="default" onClick={onClose} disabled={progress !== null}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={progress !== null} disabled={!img}>
            {progress !== null && progress < 100 ? `Uploading ${progress}%` : 'Save photo'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
