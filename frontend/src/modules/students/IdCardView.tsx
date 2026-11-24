import { Box, Image, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import type { IdCardData, IdCardPreview, IdCardTemplate } from '@/types/students';
import { formatDate } from '@/utils/format';


/**
 * On-screen rendering of a card (front, and back when the template has one). Mirrors the PDF
 * layout in backend id-card.service.ts; template colours come from the school's template data.
 */
export function IdCardView({ template, school, card, scale = 1.6 }: { template: IdCardTemplate; school: IdCardPreview['school']; card: IdCardData; scale?: number }) {
  const portrait = template.layout === 'portrait';
  const w = (portrait ? 153 : 242.6) * scale;
  const h = (portrait ? 242.6 : 153) * scale;
  const show = (f: IdCardTemplate['fields'][number]) => template.fields.includes(f);
  const pw = (portrait ? 62 : 56) * scale;
  const rows: [string, string][] = [];
  if (show('admissionNumber')) rows.push(['Adm. No', card.admissionNumber]);
  if (show('class') || show('section')) rows.push(['Class', [show('class') ? card.className : '', show('section') ? card.sectionName : ''].filter(Boolean).join(' – ')]);
  if (show('academicYear')) rows.push(['Year', card.academicYear]);
  if (show('dateOfBirth') && card.dateOfBirth) rows.push(['DOB', formatDate(card.dateOfBirth)]);
  if (show('bloodGroup') && card.bloodGroup) rows.push(['Blood', card.bloodGroup]);
  if (show('emergencyContact') && card.emergencyContact) rows.push(['Emergency', card.emergencyContact]);
  if (show('validUntil') && card.validUntil) rows.push(['Valid till', formatDate(card.validUntil)]);
  const contact = [show('schoolPhone') ? school.phone : null, show('schoolEmail') ? school.email : null].filter(Boolean).join('  ·  ');
  const photoAlign = portrait ? (template.photoPosition === 'left' ? 'flex-start' : template.photoPosition === 'right' ? 'flex-end' : 'center') : undefined;
  const initials = card.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  const photo = (
    <Box w={pw} h={pw * (4 / 3)} style={{ flexShrink: 0, borderRadius: 6, border: `${2 * (scale / 1.6)}px solid ${template.accentColor}`, overflow: 'hidden', background: 'var(--mantine-color-gray-1)' }}>
      {card.photoUrl ? (
        <Image src={card.photoUrl} alt={`Photo of ${card.name}`} w="100%" h="100%" fit="cover" />
      ) : (
        <Stack h="100%" justify="center" align="center">
          <Text fw={700} fz={18 * (scale / 1.6) * 1.4} c="dimmed">
            {initials}
          </Text>
        </Stack>
      )}
    </Box>
  );
  const details = (
    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
      <Text fw={700} fz={(portrait ? 9.5 : 9) * scale} ta={portrait ? 'center' : 'left'} lh={1.2} style={{ color: template.textColor }} lineClamp={2}>
        {card.name}
      </Text>
      {rows.map(([label, value]) => (
        <Box key={label} style={{ display: 'grid', gridTemplateColumns: `${42 * scale}px 1fr`, fontSize: 6.5 * scale, lineHeight: 1.35 }}>
          <span style={{ color: 'var(--mantine-color-dimmed)' }}>{label}</span>
          <span style={{ fontWeight: 700, color: template.textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        </Box>
      ))}
    </Stack>
  );

  const frame = (children: ReactNode, label: string) => (
    <Box
      role="img"
      aria-label={label}
      w={w}
      h={h}
      style={{ position: 'relative', borderRadius: 8 * scale * 0.7, overflow: 'hidden', background: template.backgroundColor, boxShadow: 'var(--mantine-shadow-md)', border: '1px solid var(--lekho-border)', flexShrink: 0 }}
    >
      {children}
    </Box>
  );

  const header = (
    <>
      <Box style={{ background: template.primaryColor, height: (portrait ? 46 : 38) * scale, padding: `${6 * scale}px ${8 * scale}px`, color: 'white', textAlign: 'center' }}>
        <Text fw={700} fz={8.5 * scale} lh={1.15} c="white" lineClamp={2}>
          {school.name}
        </Text>
        {show('schoolAddress') && school.address && (
          <Text fz={5.5 * scale} c="white" opacity={0.9} lineClamp={2} mt={2 * scale}>
            {school.address}
          </Text>
        )}
      </Box>
      <Box style={{ background: template.accentColor, height: 2.5 * scale }} />
    </>
  );
  const footer = (
    <>
      {template.signatureLabel && (
        <Box style={{ position: 'absolute', right: 8 * scale, bottom: 18 * scale, width: 50 * scale, borderTop: '1px solid var(--mantine-color-gray-5)', textAlign: 'center', fontSize: 5 * scale, color: 'var(--mantine-color-dimmed)' }}>{template.signatureLabel}</Box>
      )}
      <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 16 * scale, background: template.primaryColor, color: 'white', fontSize: 5.5 * scale, padding: `0 ${8 * scale}px`, display: 'flex', alignItems: 'center' }}>{contact}</Box>
    </>
  );

  return (
    <Box style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      {frame(
        <>
          {header}
          <Box p={8 * scale} pt={8 * scale} style={{ display: 'flex', flexDirection: portrait ? 'column' : template.photoPosition === 'right' ? 'row-reverse' : 'row', gap: 8 * scale, alignItems: portrait ? photoAlign : 'flex-start' }}>
            {photo}
            {details}
          </Box>
          {footer}
        </>,
        `ID card front for ${card.name}`,
      )}
      {template.showBackSide &&
        frame(
          <>
            <Box style={{ background: template.primaryColor, height: 6 * scale }} />
            <Stack p={10 * scale} gap={4 * scale} align="center" ta="center">
              <Text fw={700} fz={8 * scale} style={{ color: template.textColor }}>
                {school.name}
              </Text>
              {template.backText && (
                <Text fz={6.5 * scale} style={{ color: template.textColor }}>
                  {template.backText}
                </Text>
              )}
              {show('emergencyContact') && card.emergencyContact && <Text fz={6 * scale} c="dimmed">{`Emergency contact: ${card.emergencyContact}`}</Text>}
              {school.address && <Text fz={6 * scale} c="dimmed">{`If found, please return to: ${school.address}`}</Text>}
              {school.phone && <Text fz={6 * scale} c="dimmed">{`Phone: ${school.phone}`}</Text>}
            </Stack>
            <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 6 * scale, background: template.accentColor }} />
          </>,
          `ID card back for ${card.name}`,
        )}
    </Box>
  );
}
