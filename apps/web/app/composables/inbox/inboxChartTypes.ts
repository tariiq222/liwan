import type DashboardChart from '@/components/shared/data/DashboardChart.client.vue'

// The chart shapes the inbox reports build, taken from the shared chart component's own props (never from another application).
export type ReportChart = InstanceType<typeof DashboardChart>['$props']['chart']
export type ReportDonutChart = Extract<ReportChart, { kind: 'donut' }>
export type ReportBarChart = Extract<ReportChart, { kind: 'bar' }>
export type ReportBarDatum = ReportBarChart['data'][number]
export type ReportDatum = ReportDonutChart['data'][number]
