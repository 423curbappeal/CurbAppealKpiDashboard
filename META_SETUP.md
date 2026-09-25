# Meta KPI integration

The dashboard can preview weekly Meta ad spend and Facebook/Instagram Instant Form leads before saving a KPI week.

## Railway Variables
Set these in the Railway service:
- META_AD_ACCOUNT_ID — Meta ad account ID; with or without the act_ prefix.
- META_PAGE_IDS — comma-separated Facebook Page IDs whose Instant Forms should be counted.
- META_ACCESS_TOKEN — server-side Meta access token. Never commit this token to GitHub.
- META_GRAPH_VERSION — optional; defaults to v24.0.

The token needs access sufficient to read Ads Insights for the ad account and lead data/forms for the listed Pages.

## Test
After Railway redeploys:
1. Open /api/health. meta_configured should be true.
2. In the dashboard, select the week-ending date.
3. Click "Preview Meta".
4. Review the spend and Instant Form lead count.
5. Click "Apply to Form" and then save the week normally.

Existing localStorage KPI history is not modified by previewing Meta data.
