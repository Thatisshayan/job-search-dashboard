# Authorized Source Assessment

| Source                                                        | Assessment                                                                                                                                               | Implementation decision                                                                                                                                         |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Government of Canada Open Government dataset “Job info (API)” | The page describes an interactive road-obstacle map from the City of Repentigny, Québec, rather than active employment postings. [1]                     | **Excluded.** It must not be presented as, or used for, job-search data.                                                                                        |
| Adzuna Jobs API                                               | The developer documentation confirms REST search endpoints for its job-ad database. Calls require an `app_id` and `app_key`; responses support JSON. [2] | **Candidate licensed source.** Store the provider credentials server-side and query the documented Canadian search endpoint only after the owner supplies them. |
| Government of Canada Job Bank                                 | Job Bank’s public site is a job-search portal, but the reviewed Open Government API record was not a jobs API. [3]                                       | Use only an authorized, documented integration or direct, user-clickable Job Bank search links; do not scrape search results.                                   |

## References

[1]: https://open.canada.ca/data/en/dataset/a201ab69-0777-4a93-abed-ed89eaab7fa2
[2]: https://developer.adzuna.com/
[3]: https://www.jobbank.gc.ca/home
[4]: https://docs.composio.dev/reference/authenticating-to-composio
[5]: https://docs.composio.dev/reference/api-reference/tools

## Composio integration constraints

Composio’s documented v3.1 REST base is `https://backend.composio.dev/api/v3.1`. A project key is sent only in the server-side `x-api-key` header. The documented tools API can list available tools, return a tool schema by slug, and execute a tool using a connected account. [4] [5]

The dashboard must discover the actual connected LinkedIn and Indeed tool slugs and schemas before wiring a search request. It must not assume either toolkit supports job search, alter an account connection, or execute an unknown action. Direct application submission remains out of scope.

## Composio MCP authorization finding

The supplied MCP resource advertises `https://login.composio.dev` as its authorization server and supports Bearer authentication in the request header. The endpoint rejected Composio project API keys because it expects an AuthKit OAuth JWT associated with the MCP resource, so the connector must be configured through its OAuth authorization flow rather than with a static project-key header. [6]

[6]: https://connect.composio.dev/.well-known/oauth-protected-resource

## 2026-08-20 live-source retry

| Source                        | Observed result                                                                                                                                                                                                                                             | Current status                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Composio OAuth MCP            | Authenticated successfully. Its tool catalog exposed Dice and ZipRecruiter job-search actions, but no usable LinkedIn or Indeed job-search action.                                                                                                          | **Authenticated; limited capability.**                                                                                |
| ZipRecruiter MCP              | A read-only batch of GTA full-time construction queries returned provider `429` and connection-closed failures.                                                                                                                                             | **Degraded.** Do not repeat the identical query batch.                                                                |
| Dice MCP                      | A validated Toronto, 75 km, full-time construction-project-manager query completed but returned zero listings for the prior seven-day window.                                                                                                               | **Executable; no current matching data.**                                                                             |
| Government of Canada Job Bank | The public Toronto construction-manager market report displayed 29 listings. It exposed a current Webuild - Civil Works Inc. **construction senior project manager** posting dated 2026-08-14 at `https://www.jobbank.gc.ca/jobsearch/jobposting/50076711`. | **Research fallback only.** Individual postings must be reviewed before a user-clickable shortlist link is published. |
