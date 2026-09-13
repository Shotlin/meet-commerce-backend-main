import { beforeEach, describe, expect, it, vi } from 'vitest'

const databaseMock = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../../../src/config/database.js', () => databaseMock)

const redisMock = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }))
vi.mock('../../../src/config/redis.js', () => ({ redis: redisMock }))

vi.mock('../../../src/config/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { PublicThemeController } from '../../../src/modules/themes/public.controller.js'

const allTheme = {
  sections: {
    topBar: { backgroundColor: '#102030', textColor: '#FFFFFF' },
    searchZone: { backgroundColor: '#203040', waveColor: '#102030' },
    categoryTabs: { visible: true, textColor: '#FFFFFF', indicatorColor: '#FFFFFF' },
    headerBackground: { imageUrl: 'https://images.example/all-header.jpg' },
  },
}

function tabRow(key, themeData) {
  return {
    tab_id: `${key}-id`,
    store_key: 'zepto',
    tab_key: key,
    tab_label: key,
    tab_icon_url: null,
    tab_text_color: '#111111',
    tab_order: key === 'all' ? 0 : 1,
    theme_id: `${key}-theme`,
    ab_variant: 'A',
    theme_data: themeData,
    variant_b_theme_data: null,
    variant_b_split: null,
  }
}

function makeReply() {
  return { code: vi.fn().mockReturnThis(), header: vi.fn().mockReturnThis() }
}

beforeEach(() => {
  vi.clearAllMocks()
  redisMock.get.mockResolvedValue(null)
  databaseMock.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('fee_settings')) {
      return Promise.resolve({ rows: [{ id: 'g1', scope: 'GLOBAL', delivery_eta_minutes: 30 }] })
    }
    return Promise.resolve({ rows: [] })
  })
})

describe('GET /theme/tabs — category header isolation', () => {
  it('does not inherit the All-tab header image into a category without its own image', async () => {
    databaseMock.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('FROM theme_tabs tab')) {
        return Promise.resolve({
          rows: [
            tabRow('all', allTheme),
            tabRow('chicken', { sections: { topBar: { backgroundColor: '#D8194F' } } }),
          ],
        })
      }
      if (typeof sql === 'string' && sql.includes('fee_settings')) {
        return Promise.resolve({ rows: [{ id: 'g1', scope: 'GLOBAL', delivery_eta_minutes: 30 }] })
      }
      return Promise.resolve({ rows: [] })
    })

    const result = await new PublicThemeController().getTabThemes(
      { query: {}, headers: {} },
      makeReply(),
    )

    const chicken = result.data.tabs.find((tab) => tab.tab_key === 'chicken')
    expect(chicken.theme_data.sections.headerBackground.imageUrl).toBeNull()
    expect(chicken.theme_data.sections.topBar.backgroundColor).toBe('#D8194F')
  })

  it('keeps a category\'s own uploaded header image', async () => {
    const chickenImage = 'https://images.example/chicken-header.jpg'
    databaseMock.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('FROM theme_tabs tab')) {
        return Promise.resolve({
          rows: [
            tabRow('all', allTheme),
            tabRow('chicken', {
              sections: { headerBackground: { imageUrl: chickenImage } },
            }),
          ],
        })
      }
      if (typeof sql === 'string' && sql.includes('fee_settings')) {
        return Promise.resolve({ rows: [{ id: 'g1', scope: 'GLOBAL', delivery_eta_minutes: 30 }] })
      }
      return Promise.resolve({ rows: [] })
    })

    const result = await new PublicThemeController().getTabThemes(
      { query: {}, headers: {} },
      makeReply(),
    )

    const chicken = result.data.tabs.find((tab) => tab.tab_key === 'chicken')
    expect(chicken.theme_data.sections.headerBackground.imageUrl).toBe(chickenImage)
  })
})
