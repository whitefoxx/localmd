<!-- section 014 · pages 20–23 · raw/papers/chain-of-thought-prompting.pdf -->
# [[b20-1]] B All Experimental Results

[[b20-2]] This section contains tables for experimental results for varying models and model sizes, on all benchmarks, for standard prompting vs. chain-of-thought prompting. For the arithmetic reasoning benchmarks, some chains of thought (along with the equations produced) were correct, except the model performed an arithmetic operation incorrectly. A similar observation was made in Cobbe et al. (2021). Hence, we can further add a Python program as an external calculator (using the Python eval function) to all the equations in the generated chain of thought. When there are multiple equations in a chain of thought, we propagate the external calculator results from one equation to the following equations via string matching. As shown in Table 1, we see that adding a calculator significantly boosts performance of chain-of-thought prompting on most tasks.

[[b20-3]] Table 1: Chain of thought prompting outperforms standard prompting for various large language models on five arithmetic reasoning benchmarks. All metrics are accuracy (%). Ext. calc.: post-hoc external calculator for arithmetic computations only. Prior best numbers are from the following. a: Cobbe et al. (2021). b & e: Pi et al. (2022), c: Lan et al. (2021), d: Pi˛ekos et al. (2021).

[[b20-4]] Prompting GSM8K SVAMP ASDiv AQuA MAWPS Prior best N/A (finetuning) 55a 57.4b 75.3c 37.9d 88.4e

[[b20-5]] UL2 20B Standard 4.1 10.1 16.0 20.5 16.6

[[b20-6]] Chain of thought 4.4 (+0.3) 12.5 (+2.4) 16.9 (+0.9) 23.6 (+3.1) 19.1 (+2.5)

[[b20-7]] + ext. calc 6.9 28.3 34.3 23.6 42.7

[[b20-8]] LaMDA 137B Standard 6.5 29.5 40.1 25.5 43.2

[[b20-9]] Chain of thought 14.3 (+7.8) 37.5 (+8.0) 46.6 (+6.5) 20.6 (-4.9) 57.9 (+14.7)

[[b20-10]] + ext. calc 17.8 42.1 53.4 20.6 69.3

[[b20-11]] GPT-3 175B Standard 15.6 65.7 70.3 24.8 72.7 (text-davinci-002) Chain of thought 46.9 (+31.3) 68.9 (+3.2) 71.3 (+1.0) 35.8 (+11.0) 87.1 (+14.4)

[[b20-12]] + ext. calc 49.6 70.3 71.1 35.8 87.5

[[b20-13]] Codex Standard 19.7 69.9 74.0 29.5 78.7 (code-davinci-002) Chain of thought 63.1 (+43.4) 76.4 (+6.5) 80.4 (+6.4) 45.3 (+15.8) 92.6 (+13.9)

[[b20-14]] + ext. calc 65.4 77.0 80.0 45.3 93.3

[[b20-15]] PaLM 540B Standard 17.9 69.4 72.1 25.2 79.2

[[b20-16]] Chain of thought 56.9 (+39.0) 79.0 (+9.6) 73.9 (+1.8) 35.8 (+10.6) 93.3 (+14.2)

[[b20-17]] + ext. calc 58.6 79.8 72.6 35.8 93.5

[[b20-18]] 20

[[b21-1]] Table 2: Standard prompting versus chain of thought prompting on five arithmetic reasoning benchmarks. Note that chain of thought prompting is an emergent ability of model scale—it does not positively impact performance until used with a model of sufficient scale.

[[b21-2]] GSM8K SVAMP ASDiv AQuA MAWPS Model standard CoT standard CoT standard CoT standard CoT standard CoT UL2 20B 4.1 4.4 10.1 12.5 16.0 16.9 20.5 23.6 16.6 19.1 LaMDA 420M 2.6 0.4 2.5 1.6 3.2 0.8 23.5 8.3 3.2 0.9 2B 3.6 1.9 3.3 2.4 4.1 3.8 22.9 17.7 3.9 3.1 8B 3.2 1.6 4.3 3.4 5.9 5.0 22.8 18.6 5.3 4.8 68B 5.7 8.2 13.6 18.8 21.8 23.1 22.3 20.2 21.6 30.6 137B 6.5 14.3 29.5 37.5 40.1 46.6 25.5 20.6 43.2 57.9 GPT 350M 2.2 0.5 1.4 0.8 2.1 0.8 18.1 8.7 2.4 1.1 1.3B 2.4 0.5 1.5 1.7 2.6 1.4 12.6 4.3 3.1 1.7 6.7B 4.0 2.4 6.1 3.1 8.6 3.6 15.4 13.4 8.8 3.5 175B 15.6 46.9 65.7 68.9 70.3 71.3 24.8 35.8 72.7 87.1 Codex - 19.7 63.1 69.9 76.4 74.0 80.4 29.5 45.3 78.7 92.6 PaLM 8B 4.9 4.1 15.1 16.8 23.7 25.2 19.3 21.7 26.2 30.5 62B 9.6 29.9 48.2 46.7 58.7 61.9 25.6 22.4 61.8 80.3 540B 17.9 56.9 69.4 79.0 72.1 73.9 25.2 35.8 79.2 93.3

[[b21-3]] Table 3: Standard prompting versus chain of thought prompting on the four subsets of the MAWPS benchmark. The point of stratifying the MAWPS benchmark is to show that performance gains are minimal on easy one-step or two-step problems where large language models already achieve high performance (e.g., SingleOp, SingleEq, and AddSub).

[[b21-4]] SingleOp SingleEq AddSub MultiArith Model standard CoT standard CoT standard CoT standard CoT UL2 20B 24.9 27.2 18.0 20.2 18.5 18.2 5.0 10.7 LaMDA 420M 2.8 1.0 2.4 0.4 1.9 0.7 5.8 1.5

[[b21-5]] 2B 4.6 4.1 2.4 3.3 2.7 3.2 5.8 1.8

[[b21-6]] 8B 8.0 7.0 4.5 4.4 3.4 5.2 5.2 2.4

[[b21-7]] 68B 36.5 40.8 23.9 26.0 17.3 23.2 8.7 32.4

[[b21-8]] 137B 73.2 76.2 48.8 58.7 43.0 51.9 7.6 44.9 GPT 350M 3.2 1.8 2.0 0.2 2.0 1.5 2.3 0.8

[[b21-9]] 1.3B 5.3 3.0 2.4 1.6 2.3 1.5 2.2 0.5

[[b21-10]] 6.7B 13.5 3.9 8.7 4.9 8.6 2.5 4.5 2.8

[[b21-11]] 175B 90.9 88.8 82.7 86.6 83.3 81.3 33.8 91.7 Codex - 93.1 91.8 86.8 93.1 90.9 89.1 44.0 96.2 PaLM 8B 41.8 46.6 29.5 28.2 29.4 31.4 4.2 15.8

[[b21-12]] 62B 87.9 85.6 77.2 83.5 74.7 78.2 7.3 73.7

[[b21-13]] 540B 94.1 94.1 86.5 92.3 93.9 91.9 42.2 94.7

[[b21-14]] 21

[[b22-1]] Table 4: Standard prompting versus chain of thought prompting on five commonsense reasoning benchmarks. Chain of thought prompting is an emergent ability of model scale—it does not positively impact performance until used with a model of sufficient scale.

[[b22-2]] CSQA StrategyQA Date Sports SayCan Model standard CoT standard CoT standard CoT standard CoT standard CoT UL2 20B 34.2 51.4 59.0 53.3 13.5 14.0 57.9 65.3 20.0 41.7 LaMDA 420M 20.1 19.2 46.4 24.9 1.9 1.6 50.0 49.7 7.5 7.5

[[b22-3]] 2B 20.2 19.6 52.6 45.2 8.0 6.8 49.3 57.5 8.3 8.3

[[b22-4]] 8B 19.0 20.3 54.1 46.8 9.5 5.4 50.0 52.1 28.3 33.3

[[b22-5]] 68B 37.0 44.1 59.6 62.2 15.5 18.6 55.2 77.5 35.0 42.5

[[b22-6]] 137B 53.6 57.9 62.4 65.4 21.5 26.8 59.5 85.8 43.3 46.6 GPT 350M 14.7 15.2 20.6 0.9 4.3 0.9 33.8 41.6 12.5 0.8

[[b22-7]] 1.3B 12.0 19.2 45.8 35.7 4.0 1.4 0.0 26.9 20.8 9.2

[[b22-8]] 6.7B 19.0 24.0 53.6 50.0 8.9 4.9 0.0 4.4 17.5 35.0

[[b22-9]] 175B 79.5 73.5 65.9 65.4 43.8 52.1 69.6 82.4 81.7 87.5 Codex - 82.3 77.9 67.1 73.2 49.0 64.8 71.7 98.5 85.8 88.3 PaLM 8B 19.8 24.9 55.6 53.5 12.9 13.1 55.1 75.2 34.2 40.0

[[b22-10]] 62B 65.4 68.1 58.4 63.4 29.8 44.7 72.1 93.6 65.8 70.0

[[b22-11]] 540B 78.1 79.9 68.6 77.8 49.0 65.3 80.5 95.4 80.8 91.7

[[b22-12]] Table 5: Standard prompting versus chain of thought prompting enables length generalization to longer inference examples on two symbolic manipulation tasks.

[[b22-13]] Last Letter Concatenation Coin Flip (state tracking)

[[b22-14]] 2 OOD: 3 OOD: 4 2 OOD: 3 OOD: 4 Model standard CoT standard CoT standard CoT standard CoT standard CoT standard CoT UL2 20B 0.6 18.8 0.0 0.2 0.0 0.0 70.4 67.1 51.6 52.2 48.7 50.4 LaMDA 420M 0.3 1.6 0.0 0.0 0.0 0.0 52.9 49.6 50.0 50.5 49.5 49.1 2B 2.3 6.0 0.0 0.0 0.0 0.0 54.9 55.3 47.4 48.7 49.8 50.2 8B 1.5 11.5 0.0 0.0 0.0 0.0 52.9 55.5 48.2 49.6 51.2 50.6 68B 4.4 52.0 0.0 0.8 0.0 2.5 56.2 83.2 50.4 69.1 50.9 59.6 137B 5.8 77.5 0.0 34.4 0.0 13.5 49.0 99.6 50.7 91.0 49.1 74.5 PaLM 8B 2.6 18.8 0.0 0.0 0.0 0.2 60.0 74.4 47.3 57.1 50.9 51.8 62B 6.8 85.0 0.0 59.6 0.0 13.4 91.4 96.8 43.9 91.0 38.3 72.4 540B 7.6 99.4 0.2 94.8 0.0 63.0 98.1 100.0 49.3 98.6 54.8 90.2

[[b22-15]] 22

[[b23-1]] Table 6: Ablation and robustness results for arithmetic reasoning datasets. Chain of thought generally outperforms ablations by a large amount. “Equation only” performs in between standard prompting and chain of thought prompting, as it allows for intermediate reasoning steps via equations but does not leverage natural language. Chain of thought prompting has variance (as expected) when used with prompts written by different annotators or when using other exemplars, but still outperforms standard prompting by a large margin. Standard deviation shown is for different order of few-shot prompting exemplars, with five different random seeds. Results here are shown for LaMDA 137B, as additional queries for GPT-3 and PaLM are both limited and expensive.

[[b23-2]] GSM8K SVAMP ASDiv MAWPS

[[b23-3]] Standard prompting 6.5 ±0.4 29.5 ±0.6 40.1 ±0.6 43.2 ±0.9

[[b23-4]] Chain of thought prompting 14.3 ±0.4 36.7 ±0.4 46.6 ±0.7 57.9 ±1.5

[[b23-5]] Ablations

[[b23-6]] · equation only 5.4 ±0.2 35.1 ±0.4 45.9 ±0.6 50.1 ±1.0

[[b23-7]] · variable compute only 6.4 ±0.3 28.0 ±0.6 39.4 ±0.4 41.3 ±1.1

[[b23-8]] · reasoning after answer 6.1 ±0.4 30.7 ±0.9 38.6 ±0.6 43.6 ±1.0

[[b23-9]] Robustness

[[b23-10]] · different annotator (B) 15.5 ±0.6 35.2 ±0.4 46.5 ±0.4 58.2 ±1.0

[[b23-11]] · different annotator (C) 17.6 ±1.0 37.5 ±2.0 48.7 ±0.7 60.1 ±2.0

[[b23-12]] · intentionally concise style 11.1 ±0.3 38.7 ±0.8 48.0 ±0.3 59.6 ±0.7

[[b23-13]] · exemplars from GSM8K (α) 12.6 ±0.6 32.8 ±1.1 44.1 ±0.9 53.9 ±1.1

[[b23-14]] · exemplars from GSM8K (β) 12.7 ±0.5 34.8 ±1.1 46.9 ±0.6 60.9 ±0.8

[[b23-15]] · exemplars from GSM8K (γ) 12.6 ±0.7 35.6 ±0.5 44.4 ±2.6 54.2 ±4.7

[[b23-16]] Table 7: Ablation and robustness results for four datasets in commonsense and symbolic reasoning. Chain of thought generally outperforms ablations by a large amount. Chain of thought prompting has variance (as expected) when used with prompts written by different annotators or when using other exemplars, but still outperforms standard prompting by a large margin. Standard deviation shown is for different order of few-shot prompting exemplars, with five different random seeds. Results here are shown for LaMDA 137B, as additional queries for GPT-3 and PaLM are both limited and expensive. The exception is that we run SayCan using PaLM here, as the SayCan evaluation set is only 120 examples and therefore less expensive to run multiple times.

[[b23-17]] Commonsense Symbolic

[[b23-18]] Date Sports SayCan Concat Coin Standard prompting 21.5 ±0.6 59.5 ±3.0 80.8 ±1.8 5.8 ±0.6 49.0 ±2.1 Chain of thought prompting 26.8 ±2.1 85.8 ±1.8 91.7 ±1.4 77.5 ±3.8 99.6 ±0.3

[[b23-19]] Ablations · variable compute only 21.3 ±0.7 61.6 ±2.2 74.2 ±2.3 7.2 ±1.6 50.7 ±0.7 · reasoning after answer 20.9 ±1.0 63.0 ±2.0 83.3 ±0.6 0.0 ±0.0 50.2 ±0.5

[[b23-20]] Robustness · different annotator (B) 27.4 ±1.7 75.4 ±2.7 88.3 ±1.4 76.0 ±1.9 77.5 ±7.9 · different annotator (C) 25.5 ±2.5 81.1 ±3.6 85.0 ±1.8 68.1 ±2.2 71.4 ±11.1

[[b23-21]] 23
