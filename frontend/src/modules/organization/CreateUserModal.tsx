import { Alert, Button, Group, Modal, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Switch, TextInput } from '@mantine/core';
import { hasLength, isEmail, useForm } from '@mantine/form';
import { IconInfoCircle } from '@tabler/icons-react';
import { useNavigate } from 'react-router';
import { notifyError, notifySuccess } from '@/components/feedback/feedback';
import { useAccess } from '@/services/api/access';
import { ApiError } from '@/services/api/client';
import { schoolApi, useSchoolMutation } from '@/services/api/school';
import { unitOptions, useSchoolLookups } from './useSchoolLookups';

interface Values {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  roleIds: string[];
  unitId: string | null;
  sendInvitation: boolean;
  invitationExpiryDays: number;
}

/**
 * FRD §14.2 screen 3. Adding someone always invites them: they join once they accept. If the
 * email already has a Lekho account (another school), that account is invited as-is.
 */
export function CreateUserModal({ opened, onClose, inviteOnly }: { opened: boolean; onClose: () => void; inviteOnly?: boolean }) {
  const navigate = useNavigate();
  const access = useAccess();
  const { roles, units } = useSchoolLookups();
  const canAssignRoles = access.canOrg('roles.assign');
  const canPlace = access.canOrg('organization_units.assign');

  const create = useSchoolMutation(async (v: Values) => {
    const result = await schoolApi.createUser({
      firstName: v.firstName.trim(),
      lastName: v.lastName.trim(),
      email: v.email.trim(),
      phone: v.phone.trim() || undefined,
      roleIds: v.roleIds,
      sendInvitation: inviteOnly ? true : v.sendInvitation,
      invitationExpiryDays: v.invitationExpiryDays,
    });
    if (v.unitId) {
      await schoolApi.addUnitMember(v.unitId, result.user.id).catch((err) => notifyError(err, 'Added, but not placed in the unit'));
    }
    return result;
  });

  const form = useForm<Values>({
    mode: 'uncontrolled',
    initialValues: { firstName: '', lastName: '', email: '', phone: '', roleIds: [], unitId: null, sendInvitation: true, invitationExpiryDays: 7 },
    validate: {
      firstName: hasLength({ min: 1, max: 100 }, 'Required'),
      lastName: hasLength({ min: 1, max: 100 }, 'Required'),
      email: isEmail('Enter a valid email address'),
    },
  });
  const sendInvitation = form.useWatchValue('sendInvitation');

  const submit = async (v: Values) => {
    try {
      const result = await create.mutateAsync(v);
      notifySuccess(
        result.existingIdentity
          ? `${v.email} already has a Lekho account. They've been invited to join your school.`
          : result.invitation
            ? `Invitation sent to ${v.email}.`
            : `${v.firstName} added. Send their invitation when you're ready.`,
      );
      form.reset();
      onClose();
      if (!inviteOnly) navigate(`/users/${result.user.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') form.setFieldError('email', err.message);
      else if (err instanceof ApiError && Object.keys(err.fieldErrors).length) form.setErrors(err.fieldErrors);
      else notifyError(err);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={inviteOnly ? 'Invite someone' : 'Add user'} size="lg">
      <form onSubmit={form.onSubmit(submit)} noValidate>
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput label="First name" withAsterisk data-autofocus key={form.key('firstName')} {...form.getInputProps('firstName')} />
            <TextInput label="Last name" withAsterisk key={form.key('lastName')} {...form.getInputProps('lastName')} />
            <TextInput label="Email" type="email" withAsterisk key={form.key('email')} {...form.getInputProps('email')} />
            <TextInput label="Phone" type="tel" key={form.key('phone')} {...form.getInputProps('phone')} />
          </SimpleGrid>
          {canAssignRoles && (
            <MultiSelect
              label="Roles"
              description="You can only give roles whose permissions you hold yourself."
              data={roles.filter((r) => r.status === 'active').map((r) => ({ value: r.id, label: r.name }))}
              searchable
              key={form.key('roleIds')}
              {...form.getInputProps('roleIds')}
            />
          )}
          {canPlace && units.length > 0 && (
            <Select
              label="Department, class or section"
              placeholder="None"
              clearable
              searchable
              data={unitOptions(units, (u) => u.status === 'active')}
              key={form.key('unitId')}
              {...form.getInputProps('unitId')}
            />
          )}
          {!inviteOnly && (
            <Switch label="Send the invitation email now" key={form.key('sendInvitation')} {...form.getInputProps('sendInvitation', { type: 'checkbox' })} />
          )}
          {(inviteOnly || sendInvitation) && (
            <NumberInput label="Invitation expires after (days)" min={1} max={30} w={240} key={form.key('invitationExpiryDays')} {...form.getInputProps('invitationExpiryDays')} />
          )}
          <Alert color="info" icon={<IconInfoCircle size={18} />} variant="light">
            They join your school when they accept the invitation. New people set their own password; existing Lekho users sign in to accept.
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={form.submitting}>
              {inviteOnly || sendInvitation ? 'Send invitation' : 'Add user'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
