const core = require('@actions/core');
const github = require('@actions/github');

const sleep = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function waitForDeployment() {
  const { eventName, payload, repo } = github.context;
  const token = core.getInput('token');
  const environment = core.getInput('environment')
  const timeout = parseInt(core.getInput('timeout'), 10) * 1000;
  const endTime = new Date().getTime() + timeout;
  const appName = core.getInput('app');

  let params = {
    environment: environment,
    ...repo,
  };

  core.debug(`eventName? ${eventName}`);

  if (eventName === 'pull_request') {
    params = {
      ...params,
      sha: payload.pull_request.head.sha,
    };
  } else if (eventName === 'push') {
    params = {
      ...params,
      sha: payload.head_commit.id,
    };
  } else {
    throw new Error(`Unhandled event: ${eventName}`);
  }

  let attempt = 1;

  const octokit = github.getOctokit(token);

  while (new Date().getTime() < endTime) {
    try {
      const { data: deployments } = await octokit.repos.listDeployments(params);

      // Filter deployments by app name if specified
      const relevantDeployments = appName
        ? deployments.filter((deployment) => {
          try {
            return JSON.parse(deployment.payload).app === appName;
          } catch (e) {
            return false; // Ignore deployments with invalid or missing app payload
          }
        })
        : deployments;

      if (relevantDeployments.length > 1) {
        throw new Error(
          `There should be only one deployment for ${params.sha} but found ${relevantDeployments.length} instead.`,
        );
      }

      for (const deployment of relevantDeployments) {
        const { data: statuses } = await octokit.repos.listDeploymentStatuses({
          ...repo,
          deployment_id: deployment.id,
        });

        const [success] = statuses.filter(
          (status) => status.state === 'success',
        );
        if (success) {
          return success.target_url;
        }

        const [failure] = statuses.filter(
          (status) => status.state === 'failure',
        );
        if (failure) {
          throw new Error(
            `Deployment failed for ${params.sha}. ${failure.target_url}`,
          );
        }

      }
    } catch (error) {
      throw error;
    }

    console.log(`Url unavailable. Attempt ${attempt++}.`);

    await sleep(2);
  }

  throw new Error(
    `Timeout reached before deployment for ${params.sha} was found.`,
  );
}

(async () => {
  try {
    const url = await waitForDeployment();
    core.setOutput('url', url);
  } catch (err) {
    core.setFailed(err.message);
  }
})();
