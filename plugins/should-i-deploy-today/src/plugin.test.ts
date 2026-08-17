import { shouldIDeployTodayPlugin } from './plugin';

describe('should-i-deploy-today', () => {
  it('should export plugin', () => {
    expect(shouldIDeployTodayPlugin).toBeDefined();
  });
});
