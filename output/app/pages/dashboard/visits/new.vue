<template>
  <div class="new-visit-page">
    <div class="container-fluid">
      <div class="page-top mb-4">
        <SharedUiButtonBase variant="outline" icon-left="mdi:arrow-left" @click="navigateTo('/dashboard/visits')">
          {{ $t("back") }}
        </SharedUiButtonBase>
      </div>

      <SharedUiHeaderPage
        :title="isEditing ? $t('editVisit') : $t('newVisit')"
        :subtitle="isEditing ? $t('editVisitDesc') : $t('newVisitDesc')"
        icon="mdi:plus-circle-outline"
      />

      <div class="form-card">
        <VForm ref="formRef" :validation-schema="formSchema" :initial-values="formValues" @submit="handleSubmit">
          <div class="row g-4">
            <!-- Patient -->
            <div class="col-md-6">
              <Field name="patient_id" v-slot="{ field, errorMessage }">
                <SharedUiFormBaseSelect
                  v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                  :label="$t('patient')" :options="patientOptions" :placeholder="$t('selectPatient')"
                  :loading="isLoadingPatients" :error="!!errorMessage" :error-message="errorMessage" :required="true"
                />
              </Field>
            </div>
            <!-- Doctor -->
            <div class="col-md-6">
              <Field name="doctor_id" v-slot="{ field }">
                <SharedUiFormBaseSelect
                  v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                  :label="$t('doctor')" :options="doctorOptions" :placeholder="$t('selectDoctor')"
                  :loading="isLoadingStaff"
                />
              </Field>
            </div>
            <!-- Date -->
            <div class="col-md-4">
              <Field name="visit_date" v-slot="{ field }">
                <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                  :label="$t('visitDate')" type="datetime-local" />
              </Field>
            </div>
            <!-- Status -->
            <div class="col-md-4">
              <Field name="status" v-slot="{ field }">
                <SharedUiFormBaseSelect v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                  :label="$t('status')" :options="statusOptions" />
              </Field>
            </div>
            <!-- Fee -->
            <div class="col-md-2">
              <Field name="fee" v-slot="{ field }">
                <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                  :label="$t('fee')" type="number" :placeholder="'0.00'" icon-left="mdi:cash" />
              </Field>
            </div>
            <!-- Paid -->
            <div class="col-md-2 d-flex align-items-end pb-1">
              <label class="paid-toggle">
                <Field name="paid" v-slot="{ field }">
                  <input type="checkbox" v-bind="field" :checked="!!field.value"
                    @change="field.onChange($event.target.checked ? 1 : 0)" />
                </Field>
                <span>{{ $t("paid") }}</span>
              </label>
            </div>
            <!-- Chief Complaint -->
            <div class="col-12">
              <Field name="chief_complaint" v-slot="{ field }">
                <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                  :label="$t('chiefComplaint')" :placeholder="$t('enterComplaint')" type="textarea" :rows="2" />
              </Field>
            </div>
            <!-- Diagnosis -->
            <div class="col-12">
              <Field name="diagnosis" v-slot="{ field }">
                <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                  :label="$t('diagnosis')" :placeholder="$t('enterDiagnosis')" type="textarea" :rows="2" />
              </Field>
            </div>
            <!-- Treatment -->
            <div class="col-12">
              <Field name="treatment" v-slot="{ field }">
                <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                  :label="$t('treatment')" :placeholder="$t('enterTreatment')" type="textarea" :rows="2" />
              </Field>
            </div>
            <!-- Notes -->
            <div class="col-12">
              <Field name="notes" v-slot="{ field }">
                <SharedUiFormBaseInput v-bind="field" :model-value="field.value" @update:model-value="field.onChange"
                  :label="$t('notes')" :placeholder="$t('enterNotes')" type="textarea" :rows="2" />
              </Field>
            </div>
          </div>

          <div class="form-actions mt-4">
            <SharedUiButtonBase variant="outline" @click="navigateTo('/dashboard/visits')">{{ $t("cancel") }}</SharedUiButtonBase>
            <SharedUiButtonBase variant="primary" :loading="isSubmitting" @click="submitForm">
              <Icon name="mdi:content-save-outline" size="16" /> {{ $t("save") }}
            </SharedUiButtonBase>
          </div>
        </VForm>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Form as VForm, Field } from "vee-validate";
import { object, number, string } from "yup";

definePageMeta({ layout: "default" });

const { t } = useI18n();
const { $toast } = useNuxtApp();
const route = useRoute();
const { getVisitById, saveVisit, getPatients, getStaff } = useClinic();

const isEditing = computed(() => !!route.params.id && route.params.id !== "new");
const isSubmitting = ref(false);
const isLoadingPatients = ref(false);
const isLoadingStaff = ref(false);
const formRef = ref(null);

const patients = ref([]);
const staff = ref([]);

const patientOptions = computed(() => patients.value.map(p => ({ value: p.id, label: p.full_name })));
const doctorOptions = computed(() => [
  { value: null, label: "— " + t("unassigned") },
  ...staff.value.filter(s => s.role === "doctor" || s.role === "admin").map(s => ({ value: s.id, label: s.full_name })),
]);

const statusOptions = computed(() => [
  { value: "open", label: t("visitStatus.open") },
  { value: "closed", label: t("visitStatus.closed") },
  { value: "followup", label: t("visitStatus.followup") },
]);

const defaultDate = () => new Date().toISOString().slice(0, 16);
const emptyForm = () => ({
  patient_id: route.query.patientId ? Number(route.query.patientId) : null,
  doctor_id: null, visit_date: defaultDate(),
  chief_complaint: "", diagnosis: "", treatment: "", notes: "",
  status: "open", fee: 0, paid: 0,
});
const formValues = ref(emptyForm());

const formSchema = object({
  patient_id: number().required(t("required")).min(1, t("required")),
  doctor_id: number().nullable(),
  visit_date: string().required(t("required")),
  chief_complaint: string().nullable(),
  diagnosis: string().nullable(),
  treatment: string().nullable(),
  notes: string().nullable(),
  status: string().default("open"),
  fee: number().min(0).default(0),
  paid: number().default(0),
});

const submitForm = async () => {
  const { valid } = await formRef.value?.validate();
  if (valid) formRef.value?.$el?.requestSubmit();
};

const handleSubmit = async (values) => {
  isSubmitting.value = true;
  try {
    const payload = { ...values, id: isEditing.value ? Number(route.params.id) : undefined };
    const r = await saveVisit(payload);
    if (r.ok) {
      $toast.success(isEditing.value ? t("updateSuccess") : t("createSuccess"));
      navigateTo(`/dashboard/visits/${r.id}`);
    } else throw new Error(r.error);
  } catch (err) { $toast.error(err.message || t("operationFailed")); }
  finally { isSubmitting.value = false; }
};

onMounted(async () => {
  isLoadingPatients.value = true;
  isLoadingStaff.value = true;
  const [pr, sr] = await Promise.all([getPatients({ limit: 10000 }), getStaff()]);
  if (pr.ok) patients.value = pr.data;
  if (sr.ok) staff.value = sr.data;
  isLoadingPatients.value = false;
  isLoadingStaff.value = false;

  if (isEditing.value) {
    const vr = await getVisitById(route.params.id);
    if (vr.ok) formValues.value = { ...vr.data };
  }
});
</script>

<style lang="scss" scoped>
.new-visit-page { padding: 2rem; min-height: 100vh; background: var(--bg-page); }
.form-card {
  background: var(--bg-surface); border-radius: 16px; padding: 2rem;
  border: 1px solid var(--border-color); box-shadow: 0 2px 12px rgba(0,0,0,.05); margin-top: 1.5rem;
}
.form-actions { display: flex; justify-content: flex-end; gap: .75rem; }

.paid-toggle {
  display: flex; align-items: center; gap: .5rem; cursor: pointer; font-weight: 600;
  color: var(--text-primary); font-size: .88rem;
  input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--primary); cursor: pointer; }
}
@media (max-width: 768px) { .new-visit-page { padding: 1rem; } }
</style>
