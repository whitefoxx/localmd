<!-- section 019 · pages 30–31 · raw/papers/chain-of-thought-prompting.pdf -->
# [[b30-1]] E Additional Details

### [[b30-2]] Version Control

[[b30-3]] V5 → V6. Fixed minor typo in Figure 3. V4 → V5. Added Codex and UL2 results. Small changes to writing and style of paper. V3 → V4. Fixed typo in Figure 3 and added a couple citations. V2 → V3. Added GPT-3 results. Added SVAMP and AQuA eval datasets for math. Added SayCan eval for commonsense. Added Extended Related Work section (Appendix C). Added ablations for Commonsense and Symbolic Reasoning (Table 7). Added FAQ section (Appendix A). Added raw results in Appendix B. V1 → V2. Added PaLM results (V1 only had LaMDA).

[[b30-4]] E.1 Reproducibility Statement

[[b30-5]] As our results make use of two sets of large language models that is not publicly available, we take the following actions to facilitate reproducibility. First, we provide the exact input prompts for all tasks in Table 20–Table 27 in Appendix G (and emphasize that we do not perform any finetuning and only apply prompting to off-the-shelf language models). Second, we conduct experiments using the publicly available GPT-3 API for four model scales text-ada-001, text-babbage-001, text-curie-001, text-davinci-002). Finally, we make exact inputs, targets, and predictions for LaMDA 137B for each task available as a zip file in the supplementary material.

[[b30-6]] E.2 Computational Resources

[[b30-7]] For all three language models we evaluated, we did prompting-based inference only. No finetuning was done for this paper. For inference on LaMDA 137B we use TPU v3 (8x8 configuration, 64 chips / 128 cores), and for inference on PaLM 540B we use TPU v4 (4x4x12 configuration, 192 chips / 384 cores). GPT-3 experiments were done using the public API.5

[[b30-8]] E.3 Dataset Details and Licenses

[[b30-9]] We list the details and licenses for all arithmetic and commonsense datasets used in this paper. The symbolic reasoning datasets were created synthetically, as described in Section 4.

[[b30-10]] Arithmetic reasoning

[[b30-11]] • Math Word Problem Repository (Koncel-Kedziorski et al., 2016): AddSub (Hosseini

[[b30-12]] et al., 2014): https://www.cs.washington.edu/nlp/arithmetic; MultiArith (Roy

[[b30-13]] and Roth, 2015), license: CC BY 4.0.

[[b30-14]] • ASDiv (Miao et al., 2020): https://github.com/chaochun/nlu-asdiv-dataset.

[[b30-15]] • AQuA (Ling et al., 2017): https://github.com/deepmind/AQuA, license: https://

[[b30-16]] github.com/deepmind/AQuA/blob/master/LICENSE.

[[b30-17]] • GSM8K (Cobbe et al., 2021): https://github.com/openai/grade-school-math,

[[b30-18]] MIT license: https://github.com/openai/grade-school-math/blob/master/

[[b30-19]] LICENSE.

[[b30-20]] • SVAMP (Patel et al., 2021): https://github.com/arkilpatel/SVAMP, MIT license:

[[b30-21]] https://github.com/arkilpatel/SVAMP/blob/main/LICENSE.

[[b30-22]] Commonsense reasoning

[[b30-23]] • CSQA (Talmor et al., 2019): https://www.tau-nlp.org/commonsenseqa, https://

[[b30-24]] github.com/jonathanherzig/commonsenseqa.

[[b30-25]] 5https://beta.openai.com/docs/api-reference/making-requests

[[b30-26]] 30

[[b31-1]] • StrategyQA (Geva et al., 2021): we use the open-domain setting (question-only set) from BIG-bench collaboration (2021): https://github.com/google/BIG-bench/ tree/main/bigbench/benchmark_tasks/strategyqa. The original dataset is from https://github.com/eladsegal/strategyqa, MIT license: https://github.com/ eladsegal/strategyqa/blob/main/LICENSE.

[[b31-2]] • Date understanding and sports understanding from BIG-Bench (BIG-bench collaboration, 2021): Apache License v.2: https://github.com/google/BIG-bench/blob/main/ LICENSE.

[[b31-3]] • SayCan (Ahn et al., 2022): SayCan dataset can be accessed at https://say-can.github. io/ under CC BY 4.0 license.

[[b31-4]] 31
