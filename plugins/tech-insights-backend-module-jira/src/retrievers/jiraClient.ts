export interface JiraProject {
  key: string;
  name: string;
}

export interface JiraSearchResult {
  total: number;
  issues: Array<{
    fields: {
      created: string;
      resolutiondate?: string | null;
    };
  }>;
}

export class JiraClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    // token is a base64-encoded "email:apitoken" value — prepend "Basic "
    this.authHeader = `Basic ${token}`;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: this.authHeader,
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Jira API error ${res.status} on ${path}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async getProject(projectKey: string): Promise<JiraProject | null> {
    try {
      return await this.request<JiraProject>(`/rest/api/3/project/${encodeURIComponent(projectKey)}`);
    } catch {
      return null;
    }
  }

  /** maxResults: 0 returns only `total` (no issue bodies) — use for count-only queries */
  async searchIssues(
    jql: string,
    maxResults = 0,
    fields: string[] = ['created', 'resolutiondate'],
  ): Promise<JiraSearchResult> {
    return this.request<JiraSearchResult>('/rest/api/3/search', {
      method: 'POST',
      body: JSON.stringify({ jql, maxResults, fields }),
    });
  }
}
