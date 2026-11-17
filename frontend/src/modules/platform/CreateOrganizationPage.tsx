import { Anchor, Breadcrumbs, Button, Group, Text } from '@mantine/core';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { notifyError, notifySuccess } from '@/components/feedback/feedback';
import { ApiError } from '@/services/api/client';
import { platformApi, usePlatformMutation } from '@/services/api/platform';
import { OrganizationFields } from './OrganizationForm';
import { toOrganizationInput, useOrganizationForm, type OrganizationValues } from './organization-form';

/** FRD §14.1 screen 3. "Create" leads straight into School Admin provisioning on the detail page. */
export function CreateOrganizationPage() {
  const navigate = useNavigate();
  const form = useOrganizationForm();
  const create = usePlatformMutation((input: { values: OrganizationValues; draft: boolean }) =>
    platformApi.createOrganization({ ...toOrganizationInput(input.values), saveAsDraft: input.draft }),
  );

  const save = async (values: OrganizationValues, draft: boolean) => {
    try {
      const org = await create.mutateAsync({ values, draft });
      notifySuccess(draft ? `${org.name} saved as a draft.` : `${org.name} created. Next, provision its School Admin.`);
      navigate(`/platform/organizations/${org.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const fields = (err.details as { fields?: string[] })?.fields ?? [];
        for (const f of fields) form.setFieldError(f, `This ${f} is already in use`);
        if (!fields.length) notifyError(err);
      } else if (err instanceof ApiError && Object.keys(err.fieldErrors).length) {
        form.setErrors(err.fieldErrors);
      } else {
        notifyError(err);
      }
    }
  };

  const saveDraft = () => {
    const nameCheck = form.validateField('name');
    const slugCheck = form.validateField('slug');
    const codeCheck = form.validateField('code');
    const emailCheck = form.validateField('email');
    if (!nameCheck.hasError && !slugCheck.hasError && !codeCheck.hasError && !emailCheck.hasError) void save(form.getValues(), true);
  };

  return (
    <>
      <Breadcrumbs mb="md">
        <Anchor component={Link} to="/platform/organizations" size="sm">
          Organizations
        </Anchor>
        <Text size="sm">New</Text>
      </Breadcrumbs>
      <PageHeader title="Create organization" description="Add a school to Lekho. You'll provision its first School Admin next." />
      <form onSubmit={form.onSubmit((v) => save(v, false))} noValidate style={{ maxWidth: 880 }}>
        <OrganizationFields form={form} />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={saveDraft} disabled={create.isPending}>
            Save draft
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create organization
          </Button>
        </Group>
      </form>
    </>
  );
}
