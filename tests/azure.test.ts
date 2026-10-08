import { describe, expect, it } from 'vitest';
import { azureRepoWebUrl, pullRequestCreateUrl } from '../electron/services/azure';
describe('Azure DevOps', () => {
  it('reconhece remotos HTTPS, SSH, visualstudio.com e Azure DevOps Server', () => {
    expect(azureRepoWebUrl('https://minhaorg@dev.azure.com/minhaorg/Vendas/_git/Portal')).toBe('https://dev.azure.com/minhaorg/Vendas/_git/Portal');
    expect(azureRepoWebUrl('https://usuario:segredo@dev.azure.com/minhaorg/Meu%20Projeto/_git/Meu%20Repo/')).toBe('https://dev.azure.com/minhaorg/Meu%20Projeto/_git/Meu%20Repo');
    expect(azureRepoWebUrl('git@ssh.dev.azure.com:v3/minhaorg/Vendas/Portal')).toBe('https://dev.azure.com/minhaorg/Vendas/_git/Portal');
    expect(azureRepoWebUrl('ssh://git@ssh.dev.azure.com/v3/minhaorg/Vendas/Portal')).toBe('https://dev.azure.com/minhaorg/Vendas/_git/Portal');
    expect(azureRepoWebUrl('minhaorg@vs-ssh.visualstudio.com:v3/minhaorg/Vendas/Portal')).toBe('https://dev.azure.com/minhaorg/Vendas/_git/Portal');
    expect(azureRepoWebUrl('https://minhaorg.visualstudio.com/DefaultCollection/Vendas/_git/Portal')).toBe('https://minhaorg.visualstudio.com/DefaultCollection/Vendas/_git/Portal');
    expect(azureRepoWebUrl('https://tfs.empresa.com.br/tfs/Colecao/Vendas/_git/Portal')).toBe('https://tfs.empresa.com.br/tfs/Colecao/Vendas/_git/Portal');
  });
  it('ignora remotos que não são do Azure', () => {
    expect(azureRepoWebUrl('https://github.com/usuario/repo.git')).toBeNull();
    expect(azureRepoWebUrl('git@github.com:usuario/repo.git')).toBeNull();
    expect(azureRepoWebUrl('C:/repos/remote.git')).toBeNull();
    expect(azureRepoWebUrl('file:///C:/x/_git/repo')).toBeNull();
  });
  it('monta o link de criação de PR com os ramos codificados', () => {
    expect(pullRequestCreateUrl('https://dev.azure.com/o/p/_git/r', 'feature/DDVENDAS-1', 'main')).toBe('https://dev.azure.com/o/p/_git/r/pullrequestcreate?sourceRef=feature%2FDDVENDAS-1&targetRef=main');
  });
});
