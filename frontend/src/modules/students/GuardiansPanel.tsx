import { ActionIcon, Alert, Badge, Button, Card, Checkbox, EmptyState, Group, Menu, Modal, PinInput, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { hasLength, useForm } from '@mantine/form';
import { useInterval } from '@mantine/hooks';
import { IconDots, IconInfoCircle, IconPencil, IconPhone, IconPlus, IconShieldCheck, IconStar, IconTrash, IconUserPlus } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { EntityStatus } from '@/components/EntityStatus';
import { confirmAction, errorMessage, notifyError, notifySuccess } from '@/components/feedback/feedback';
import { ApiError } from '@/services/api/client';
import { useSchoolMutation } from '@/services/api/school';
import { studentsApi, type GuardianInput } from '@/services/api/students';
import type { Guardian, GuardianRelationship, OtpSent } from '@/types/students';
import { formatDateTime } from '@/utils/format';
import { RELATIONSHIP_LABEL, formatPhone } from './student-helpers';

/**
 * Parents, guardians and other contacts (FRD §4). At least one father, mother or guardian must
 * have an OTP-verified mobile number before registration completes.
 */
export function GuardiansPanel({ studentId, guardians, canManage }: { studentId: string; guardians: Guardian[]; canManage: boolean }) {
  const [editing, setEditing] = useState<Guardian | 'new' | null>(null);
  const [verifying, setVerifying] = useState<Guardian | null>(null);
  const update = useSchoolMutation(({ id, body }: { id: string; body: GuardianInput }) => studentsApi.updateGuardian(studentId, id, body));
  const remove = useSchoolMutation((id: string) => studentsApi.removeGuardian(studentId, id));
  const verifiedParent = guardians.some((g) => g.verificationStatus === 'verified' && g.relationship !== 'other');

  return (
    <Stack gap="md">
      {!verifiedParent && (
        <Alert color="warning" variant="light" icon={<IconInfoCircle size={18} />}>
          Verify at least one father's, mother's or guardian's mobile number. A code is sent by SMS; the parent shares it with you.
        </Alert>
      )}
      {guardians.length === 0 ? (
        <Card>
          <EmptyState icon={<IconUserPlus size={28} stroke={1.75} />} title="No parents or guardians yet" description="Add the father, mother or guardian, then verify their mobile number." py="lg">
            {canManage && (
              <EmptyState.Actions>
                <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
                  Add parent or guardian
                </Button>
              </EmptyState.Actions>
            )}
          </EmptyState>
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          {guardians.map((g) => (
            <Card key={g.id} withBorder>
              <Stack gap="xs">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <div>
                    <Group gap={6}>
                      <Text fw={600}>{g.fullName}</Text>
                      {g.isPrimaryContact && (
                        <Badge size="sm" variant="light" leftSection={<IconStar size={12} />}>
                          Primary
                        </Badge>
                      )}
                      {g.isEmergencyContact && (
                        <Badge size="sm" variant="light" color="warning">
                          Emergency
                        </Badge>
                      )}
                    </Group>
                    <Text size="sm" c="dimmed">
                      {g.relationship === 'other' && g.relationshipLabel ? g.relationshipLabel : RELATIONSHIP_LABEL[g.relationship]}
                      {g.occupation ? ` · ${g.occupation}` : ''}
                    </Text>
                  </div>
                  {canManage && (
                    <Menu position="bottom-end" shadow="md">
                      <Menu.Target>
                        <ActionIcon variant="subtle" color="neutral" aria-label={`Actions for ${g.fullName}`}>
                          <IconDots size={18} stroke={1.75} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<IconPencil size={16} stroke={1.75} />} onClick={() => setEditing(g)}>
                          Edit
                        </Menu.Item>
                        {!g.isPrimaryContact && g.mobileNumber && (
                          <Menu.Item
                            leftSection={<IconStar size={16} stroke={1.75} />}
                            onClick={() => update.mutate({ id: g.id, body: { isPrimaryContact: true } }, { onSuccess: () => notifySuccess(`${g.fullName} is now the primary contact`), onError: (e) => notifyError(e) })}
                          >
                            Make primary contact
                          </Menu.Item>
                        )}
                        <Menu.Item
                          color="error"
                          leftSection={<IconTrash size={16} stroke={1.75} />}
                          onClick={() =>
                            confirmAction({
                              title: `Remove ${g.fullName}?`,
                              message: 'They will no longer be a contact for this student.',
                              confirmLabel: 'Remove',
                              destructive: true,
                              onConfirm: () => remove.mutateAsync(g.id),
                              successMessage: 'Contact removed',
                            })
                          }
                        >
                          Remove
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
                <Group gap="xs">
                  <IconPhone size={16} stroke={1.75} />
                  <Text size="sm" className="tabular-nums">
                    {formatPhone(g.mobileNumber)}
                  </Text>
                  {g.mobileNumber && <EntityStatus status={g.verificationStatus} size="sm" />}
                </Group>
                {g.verifiedAt && (
                  <Text size="xs" c="dimmed">
                    Verified {formatDateTime(g.verifiedAt)}
                  </Text>
                )}
                {g.email && (
                  <Text size="sm" c="dimmed">
                    {g.email}
                  </Text>
                )}
                {canManage && g.mobileNumber && g.verificationStatus === 'unverified' && (
                  <Button size="xs" variant="light" leftSection={<IconShieldCheck size={14} />} onClick={() => setVerifying(g)} w="fit-content">
                    Verify by OTP
                  </Button>
                )}
              </Stack>
            </Card>
          ))}
        </SimpleGrid>
      )}
      {canManage && guardians.length > 0 && guardians.length < 10 && (
        <Group>
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Add contact
          </Button>
        </Group>
      )}
      {editing && (
        <GuardianModal
          studentId={studentId}
          guardian={editing === 'new' ? undefined : editing}
          isFirst={guardians.length === 0}
          onClose={() => setEditing(null)}
          onSaved={(g) => {
            setEditing(null);
            if (g.mobileNumber && g.verificationStatus === 'unverified' && g.relationship !== 'other') setVerifying(g);
          }}
        />
      )}
      {verifying && <OtpModal studentId={studentId} guardian={verifying} onClose={() => setVerifying(null)} />}
    </Stack>
  );
}

function GuardianModal({ studentId, guardian, isFirst, onClose, onSaved }: { studentId: string; guardian?: Guardian; isFirst: boolean; onClose: () => void; onSaved: (g: Guardian) => void }) {
  const save = useSchoolMutation((body: GuardianInput) =>
    guardian ? studentsApi.updateGuardian(studentId, guardian.id, body) : studentsApi.addGuardian(studentId, body as GuardianInput & { fullName: string; relationship: GuardianRelationship }),
  );
  const form = useForm({
    mode: 'uncontrolled',
    initialValues: {
      fullName: guardian?.fullName ?? '',
      relationship: (guardian?.relationship ?? (isFirst ? 'father' : '')) as GuardianRelationship | '',
      relationshipLabel: guardian?.relationshipLabel ?? '',
      mobileNumber: guardian?.mobileNumber ?? '',
      alternateMobileNumber: guardian?.alternateMobileNumber ?? '',
      email: guardian?.email ?? '',
      occupation: guardian?.occupation ?? '',
      isPrimaryContact: guardian?.isPrimaryContact ?? isFirst,
      isEmergencyContact: guardian?.isEmergencyContact ?? false,
    },
    validate: {
      fullName: hasLength({ min: 1, max: 150 }, 'Required'),
      relationship: (v) => (v ? null : 'Required'),
      mobileNumber: (v, values) => (values.isPrimaryContact && !v.trim() ? 'The primary contact needs a mobile number' : null),
    },
  });
  const relationship = form.useWatchValue('relationship');
  const submit = async (v: typeof form.values) => {
    const opt = (x: string) => x.trim() || null;
    try {
      const saved = await save.mutateAsync({
        fullName: v.fullName.trim(),
        relationship: v.relationship as GuardianRelationship,
        relationshipLabel: v.relationship === 'other' ? opt(v.relationshipLabel) : null,
        mobileNumber: opt(v.mobileNumber),
        alternateMobileNumber: opt(v.alternateMobileNumber),
        email: opt(v.email),
        occupation: opt(v.occupation),
        ...(!guardian?.isPrimaryContact && { isPrimaryContact: v.isPrimaryContact }),
        isEmergencyContact: v.isEmergencyContact,
      });
      notifySuccess(guardian ? 'Contact updated' : `${v.fullName} added`);
      onSaved(saved);
    } catch (err) {
      const fields = err instanceof ApiError ? err.fieldErrors : {};
      if (Object.keys(fields).length) form.setErrors(fields);
      else notifyError(err);
    }
  };
  const numberChanging = guardian?.verificationStatus === 'verified';
  return (
    <Modal opened onClose={onClose} title={guardian ? `Edit ${guardian.fullName}` : 'Add parent or guardian'} size="lg">
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput label="Full name" withAsterisk data-autofocus key={form.key('fullName')} {...form.getInputProps('fullName')} />
            <Select
              label="Relationship"
              withAsterisk
              data={(Object.keys(RELATIONSHIP_LABEL) as GuardianRelationship[]).map((r) => ({ value: r, label: RELATIONSHIP_LABEL[r] }))}
              key={form.key('relationship')}
              {...form.getInputProps('relationship')}
            />
          </SimpleGrid>
          {relationship === 'other' && <TextInput label="Describe the relationship" placeholder="Grandmother, uncle, driver…" key={form.key('relationshipLabel')} {...form.getInputProps('relationshipLabel')} />}
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput
              label="Mobile number"
              description={numberChanging ? 'Changing a verified number needs a new OTP.' : 'Used for OTP verification.'}
              placeholder="98765 43210"
              inputMode="tel"
              key={form.key('mobileNumber')}
              {...form.getInputProps('mobileNumber')}
            />
            <TextInput label="Alternate mobile" inputMode="tel" key={form.key('alternateMobileNumber')} {...form.getInputProps('alternateMobileNumber')} />
            <TextInput label="Email" type="email" key={form.key('email')} {...form.getInputProps('email')} />
            <TextInput label="Occupation" key={form.key('occupation')} {...form.getInputProps('occupation')} />
          </SimpleGrid>
          <Group>
            {!guardian?.isPrimaryContact && <Checkbox label="Primary contact" key={form.key('isPrimaryContact')} {...form.getInputProps('isPrimaryContact', { type: 'checkbox' })} />}
            <Checkbox label="Emergency contact" key={form.key('isEmergencyContact')} {...form.getInputProps('isEmergencyContact', { type: 'checkbox' })} />
          </Group>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              {guardian ? 'Save' : 'Add'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Send a code, have the parent read it out, enter it. Handles resend cooldown and lockout. */
function OtpModal({ studentId, guardian, onClose }: { studentId: string; guardian: Guardian; onClose: () => void }) {
  const send = useSchoolMutation(() => studentsApi.sendOtp(studentId, guardian.id));
  const verify = useSchoolMutation((otp: string) => studentsApi.verifyOtp(studentId, guardian.id, otp));
  const [sent, setSent] = useState<OtpSent | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const ticker = useInterval(() => setNow(Date.now()), 1000);

  useEffect(() => {
    ticker.start();
    return ticker.stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once
  }, []);

  const doSend = async () => {
    setError(null);
    try {
      setSent(await send.mutateAsync(undefined));
      setCode('');
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const doVerify = async (value = code) => {
    if (value.length < 4) return;
    setError(null);
    try {
      await verify.mutateAsync(value);
      notifySuccess(`${formatPhone(guardian.mobileNumber)} verified`);
      onClose();
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as { attemptsRemaining?: number }) : undefined;
      setError(details?.attemptsRemaining !== undefined && details.attemptsRemaining > 0 ? `${errorMessage(err)} ${details.attemptsRemaining} attempt${details.attemptsRemaining === 1 ? '' : 's'} left.` : errorMessage(err));
      setCode('');
    }
  };

  const resendIn = sent ? Math.max(0, Math.ceil((new Date(sent.resendAvailableAt).getTime() - now) / 1000)) : 0;
  const expired = sent ? new Date(sent.expiresAt).getTime() <= now : false;

  return (
    <Modal opened onClose={onClose} title={`Verify ${guardian.fullName}'s mobile`}>
      <Stack gap="md">
        {!sent ? (
          <>
            <Text>
              We'll send a one-time code by SMS to <b className="tabular-nums">{formatPhone(guardian.mobileNumber)}</b>. Ask the parent to read it out to you.
            </Text>
            {error && (
              <Alert color="error" variant="light">
                {error}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={doSend} loading={send.isPending}>
                Send code
              </Button>
            </Group>
          </>
        ) : (
          <>
            <Text size="sm">
              Code sent to <b className="tabular-nums">{sent.sentTo}</b>. {expired ? 'It has expired.' : `It expires at ${new Date(sent.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`}
            </Text>
            <Group justify="center">
              <PinInput length={sent.codeLength} type="number" oneTimeCode value={code} onChange={setCode} onComplete={(v) => void doVerify(v)} disabled={verify.isPending || expired} aria-label="One-time code" autoFocus />
            </Group>
            {error && (
              <Alert color="error" variant="light">
                {error}
              </Alert>
            )}
            <Group justify="space-between">
              <Button variant="subtle" size="sm" disabled={resendIn > 0} onClick={doSend} loading={send.isPending}>
                {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
              </Button>
              <Button onClick={() => void doVerify()} loading={verify.isPending} disabled={code.length < sent.codeLength || expired}>
                Verify
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              Verification confirms the parent controls this number today. It doesn't prove identity or relationship.
            </Text>
          </>
        )}
      </Stack>
    </Modal>
  );
}
