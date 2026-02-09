// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://runbook-agent.github.io',
	base: '/RunbookAI',
	integrations: [
		starlight({
			title: 'Runbook',
			description: 'AI-powered SRE assistant for incident investigation and operational workflows',
			logo: {
				light: './src/assets/logo-light.svg',
				dark: './src/assets/logo-dark.svg',
				replacesTitle: false,
			},
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/Runbook-Agent/RunbookAI' },
			],
			customCss: [
				'./src/styles/custom.css',
			],
			head: [
				{
					tag: 'meta',
					attrs: {
						name: 'og:image',
						content: 'https://runbook-agent.github.io/RunbookAI/og-image.png',
					},
				},
				{
					tag: 'meta',
					attrs: {
						name: 'twitter:card',
						content: 'summary_large_image',
					},
				},
			],
			editLink: {
				baseUrl: 'https://github.com/Runbook-Agent/RunbookAI/edit/main/docs-site/',
			},
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Quick Start', slug: 'getting-started/quickstart' },
						{ label: 'Configuration', slug: 'getting-started/configuration' },
					],
				},
				{
					label: 'Core Concepts',
					items: [
						{ label: 'Architecture', slug: 'concepts/architecture' },
						{ label: 'Investigation Flow', slug: 'concepts/investigation-flow' },
						{ label: 'Hypothesis System', slug: 'concepts/hypothesis' },
						{ label: 'Evidence & Confidence', slug: 'concepts/evidence' },
						{ label: 'Safety & Approvals', slug: 'concepts/safety' },
					],
				},
				{
					label: 'CLI Reference',
					items: [
						{ label: 'Overview', slug: 'cli/overview' },
						{ label: 'ask', slug: 'cli/ask' },
						{ label: 'investigate', slug: 'cli/investigate' },
						{ label: 'chat', slug: 'cli/chat' },
						{ label: 'deploy', slug: 'cli/deploy' },
						{ label: 'knowledge', slug: 'cli/knowledge' },
						{ label: 'init', slug: 'cli/init' },
						{ label: 'config', slug: 'cli/config' },
						{ label: 'webhook', slug: 'cli/webhook' },
					],
				},
				{
					label: 'Integrations',
					items: [
						{ label: 'AWS', slug: 'integrations/aws' },
						{ label: 'Kubernetes', slug: 'integrations/kubernetes' },
						{ label: 'PagerDuty', slug: 'integrations/pagerduty' },
						{ label: 'OpsGenie', slug: 'integrations/opsgenie' },
						{ label: 'Slack', slug: 'integrations/slack' },
						{ label: 'Datadog', slug: 'integrations/datadog' },
						{ label: 'Prometheus', slug: 'integrations/prometheus' },
					],
				},
				{
					label: 'Knowledge System',
					items: [
						{ label: 'Overview', slug: 'knowledge/overview' },
						{ label: 'Document Types', slug: 'knowledge/document-types' },
						{ label: 'Sources', slug: 'knowledge/sources' },
						{ label: 'Search & Retrieval', slug: 'knowledge/search' },
						{ label: 'Writing Runbooks', slug: 'knowledge/writing-runbooks' },
					],
				},
				{
					label: 'Skills',
					items: [
						{ label: 'Overview', slug: 'skills/overview' },
						{ label: 'Built-in Skills', slug: 'skills/builtin' },
						{ label: 'Custom Skills', slug: 'skills/custom' },
						{ label: 'Execution Model', slug: 'skills/execution' },
					],
				},
				{
					label: 'Tools Reference',
					collapsed: true,
					items: [
						{ label: 'Overview', slug: 'tools/overview' },
						{ label: 'AWS Tools', slug: 'tools/aws' },
						{ label: 'Kubernetes Tools', slug: 'tools/kubernetes' },
						{ label: 'Incident Tools', slug: 'tools/incident' },
						{ label: 'Observability Tools', slug: 'tools/observability' },
						{ label: 'Knowledge Tools', slug: 'tools/knowledge' },
					],
				},
				{
					label: 'Advanced',
					collapsed: true,
					items: [
						{ label: 'Scratchpad & Audit Trail', slug: 'advanced/scratchpad' },
						{ label: 'Context Engineering', slug: 'advanced/context' },
						{ label: 'Multi-Provider LLM', slug: 'advanced/llm-providers' },
						{ label: 'Webhook Server', slug: 'advanced/webhook-server' },
					],
				},
				{
					label: 'Examples',
					items: [
						{ label: 'Incident Investigation', slug: 'examples/incident-investigation' },
						{ label: 'Service Deployment', slug: 'examples/deployment' },
						{ label: 'Cost Analysis', slug: 'examples/cost-analysis' },
						{ label: 'Security Audit', slug: 'examples/security-audit' },
					],
				},
			],
			components: {
				Hero: './src/components/Hero.astro',
			},
		}),
	],
});
