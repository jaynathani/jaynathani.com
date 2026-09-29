# jaynathani.github.io

The personal portfolio of **Jay Nathani**. Live at **[jaynathani.github.io](https://jaynathani.github.io)**.

## About me

I'm a **Senior Site Reliability Engineer** at CarGurus and am 3× AWS certified. I'm most interested in how reliability works in the new AI world. Systems built on LLMs and autonomous agents don't behave deterministically, so the classic SRE toolkit needs rethinking. My current work in this area includes:

- **Agentic Chaos Engineering (ACE):** injecting semantic faults into multi-agent workflows to see how they fail.
- **Safety invariants:** hard blast-radius limits on automated remediation.
- **Reliable LLM inference:** token-aware load balancing and semantic SLOs.

Before that I worked through the whole stack: electronics and embedded systems, then industrial IoT, then cloud infrastructure as code on AWS, GCP and Azure, and now reliability at scale.

- LinkedIn: [in/jaynathani](https://www.linkedin.com/in/jaynathani/)
- Writing: [Prometheus and its Federation through Thanos at CarGurus](https://cargurus.dev/2022/11/23/prometheus-and-its-federation-through-thanos-at-cargurus-part-1/)
- Résumé: [Jay-Nathani-Resume.pdf](Jay-Nathani-Resume.pdf)

## About the site

The site is designed around a "Chip to Cloud" idea. The hero is a live, computer-generated circuit board drawn on a `<canvas>`. Pulses run along the traces, the board brightens under your cursor, and the navigation sits on chips wired to the main chip. As you scroll, the board zooms out and changes color for each stage of my career: Silicon, Edge/IoT, Cloud and Reliability.

It's plain HTML, CSS and JavaScript, with no frameworks and no build step.

```
index.html          page content
assets/board.js     circuit-board engine (routing, camera, pulses)
assets/main.js      scroll reveals, layer rail, game/video viewer
assets/style.css    styles
NewGame/            Arkanoid (canvas game)
TicTacToe/          Tic Tac Toe (canvas game)
```

## Run locally

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080. Pushing to `master` deploys the site through GitHub Pages.
