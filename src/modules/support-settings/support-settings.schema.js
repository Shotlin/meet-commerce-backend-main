export const getPublicSettingsSchema = {
  tags: ['Support Settings'],
  summary: 'Brand name / support phone / support email — public, no auth (mobile "Need Help" / "Contact Us")',
}

export const getAdminSettingsSchema = {
  tags: ['Support Settings'],
  summary: 'Brand name / support phone / support email (admin)',
}

export const updateSettingsSchema = {
  tags: ['Support Settings'],
  summary: 'Update brand name / support phone / support email',
  body: {
    type: 'object',
    properties: {
      brandName: { type: 'string', minLength: 1, maxLength: 100 },
      supportPhone: { type: 'string', maxLength: 30 },
      supportEmail: { type: 'string', maxLength: 200 },
    },
  },
}
