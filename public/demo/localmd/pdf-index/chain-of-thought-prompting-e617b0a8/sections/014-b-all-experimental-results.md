<!-- section 014 · pages 20–23 · raw/papers/chain-of-thought-prompting.pdf -->
# [[b20-1]] B All Experimental Results

[[b20-2]] This section contains tables for experimental results for varying models and model sizes, on all benchmarks, for standard prompting vs. chain-of-thought prompting. For the arithmetic reasoning benchmarks, some chains of thought (along with the equations produced) were correct, except the model performed an arithmetic operation incorrectly. A similar observation was made in Cobbe et al. (2021). Hence, we can further add a Python program as an external calculator (using the Python eval function) to all the equations in the generated chain of thought. When there are multiple equations in a chain of thought, we propagate the external calculator results from one equation to the following equations via string matching. As shown in Table 1, we see that adding a calculator significantly boosts performance of chain-of-thought prompting on most tasks.

[[b20-3]] Table 1: Chain of thought prompting outperforms standard prompting for various large language models on five arithmetic reasoning benchmarks. All metrics are accuracy (%). Ext. calc.: post-hoc external calculator for arithmetic computations only. Prior best numbers are from the following. a: Cobbe et al. (2021). b & e: Pi et al. (2022), c: Lan et al. (2021), d: Pi˛ekos et al. (2021).

[[b20-4]] Prompting Prior best

[[b20-5]] UL2 20B

[[b20-6]] Chain of thought 4.4 (+0.3)

[[b20-7]] + ext. calc

[[b20-8]] LaMDA 137B

[[b20-9]] + ext. calc

[[b20-10]] GPT-3 175B (text-davinci-002) Chain of thought 46.9 (+31.3) 68.9 (+3.2) 71.3 (+1.0) 35.8 (+11.0) 87.1 (+14.4)

[[b20-11]] + ext. calc

[[b20-12]] Codex (code-davinci-002) Chain of thought 63.1 (+43.4) 76.4 (+6.5) 80.4 (+6.4) 45.3 (+15.8) 92.6 (+13.9)

[[b20-13]] + ext. calc

[[b20-14]] PaLM 540B

[[b20-15]] + ext. calc

[[b20-16]] GSM8K SVAMP ASDiv

[[b20-17]] AQuA

[[b20-18]] MAWPS

[[b20-19]] N/A (finetuning) 55a

[[b20-20]] 57.4b

[[b20-21]] 75.3c

[[b20-22]] 37.9d

[[b20-23]] 88.4e

[[b20-24]] Standard

[[b20-25]] 4.1

[[b20-26]] 10.1

[[b20-27]] 16.0

[[b20-28]] 20.5

[[b20-29]] 16.6

[[b20-30]] 12.5 (+2.4) 16.9 (+0.9) 23.6 (+3.1) 19.1 (+2.5)

[[b20-31]] 6.9

[[b20-32]] 28.3

[[b20-33]] 34.3

[[b20-34]] 23.6

[[b20-35]] 42.7

[[b20-36]] Standard

[[b20-37]] 6.5

[[b20-38]] 29.5

[[b20-39]] 40.1

[[b20-40]] 25.5

[[b20-41]] 43.2

[[b20-42]] Chain of thought 14.3 (+7.8) 37.5 (+8.0) 46.6 (+6.5) 20.6 (-4.9) 57.9 (+14.7)

[[b20-43]] 17.8

[[b20-44]] 42.1

[[b20-45]] 53.4

[[b20-46]] 20.6

[[b20-47]] 69.3

[[b20-48]] Standard

[[b20-49]] 15.6

[[b20-50]] 65.7

[[b20-51]] 70.3

[[b20-52]] 24.8

[[b20-53]] 72.7

[[b20-54]] 49.6

[[b20-55]] 70.3

[[b20-56]] 71.1

[[b20-57]] 35.8

[[b20-58]] 87.5

[[b20-59]] Standard

[[b20-60]] 19.7

[[b20-61]] 69.9

[[b20-62]] 74.0

[[b20-63]] 29.5

[[b20-64]] 78.7

[[b20-65]] 65.4

[[b20-66]] 77.0

[[b20-67]] 80.0

[[b20-68]] 45.3

[[b20-69]] 93.3

[[b20-70]] Standard

[[b20-71]] 17.9

[[b20-72]] 69.4

[[b20-73]] 72.1

[[b20-74]] 25.2

[[b20-75]] 79.2

[[b20-76]] Chain of thought 56.9 (+39.0) 79.0 (+9.6) 73.9 (+1.8) 35.8 (+10.6) 93.3 (+14.2)

[[b20-77]] 58.6

[[b20-78]] 79.8

[[b20-79]] 72.6

[[b20-80]] 35.8

[[b20-81]] 93.5

[[b20-82]] 20

[[b21-1]] Table 2: Standard prompting versus chain of thought prompting on five arithmetic reasoning benchmarks. Note that chain of thought prompting is an emergent ability of model scale—it does not positively impact performance until used with a model of sufficient scale.

[[b21-2]] GSM8K

[[b21-3]] standard CoT standard CoT standard CoT standard CoT standard CoT

[[b21-4]] 20B

[[b21-5]] LaMDA 420M 2B 8B 68B 137B

[[b21-6]] 350M 1.3B 6.7B 175B

[[b21-7]] Codex -

[[b21-8]] PaLM 8B 62B 540B

[[b21-9]] Table 3: Standard prompting versus chain of thought prompting on the four subsets of the MAWPS benchmark. The point of stratifying the MAWPS benchmark is to show that performance gains are minimal on easy one-step or two-step problems where large language models already achieve high performance (e.g., SingleOp, SingleEq, and AddSub).

[[b21-10]] SingleOp

[[b21-11]] Model

[[b21-12]] UL2

[[b21-13]] LaMDA 420M

[[b21-14]] 2B

[[b21-15]] 8B

[[b21-16]] 68B

[[b21-17]] 137B

[[b21-18]] GPT

[[b21-19]] 1.3B

[[b21-20]] 6.7B

[[b21-21]] 175B

[[b21-22]] Codex -

[[b21-23]] PaLM 8B

[[b21-24]] 62B

[[b21-25]] 540B

[[b21-26]] SVAMP

[[b21-27]] ASDiv

[[b21-28]] AQuA

[[b21-29]] MAWPS

[[b21-30]] Model

[[b21-31]] UL2

[[b21-32]] 4.1 4.4

[[b21-33]] 10.1 12.5

[[b21-34]] 16.0 16.9

[[b21-35]] 20.5 23.6

[[b21-36]] 16.6 19.1

[[b21-37]] 2.6 0.4

[[b21-38]] 2.5 1.6

[[b21-39]] 3.2 0.8

[[b21-40]] 23.5 8.3

[[b21-41]] 3.2 0.9

[[b21-42]] 3.6 1.9

[[b21-43]] 3.3 2.4

[[b21-44]] 4.1 3.8

[[b21-45]] 22.9 17.7

[[b21-46]] 3.9 3.1

[[b21-47]] 3.2 1.6

[[b21-48]] 4.3 3.4

[[b21-49]] 5.9 5.0

[[b21-50]] 22.8 18.6

[[b21-51]] 5.3 4.8

[[b21-52]] 5.7 8.2

[[b21-53]] 13.6 18.8

[[b21-54]] 21.8 23.1

[[b21-55]] 22.3 20.2

[[b21-56]] 21.6 30.6

[[b21-57]] 6.5 14.3

[[b21-58]] 29.5 37.5

[[b21-59]] 40.1 46.6

[[b21-60]] 25.5 20.6

[[b21-61]] 43.2 57.9

[[b21-62]] GPT

[[b21-63]] 2.2 0.5

[[b21-64]] 1.4 0.8

[[b21-65]] 2.1 0.8

[[b21-66]] 18.1 8.7

[[b21-67]] 2.4 1.1

[[b21-68]] 2.4 0.5

[[b21-69]] 1.5 1.7

[[b21-70]] 2.6 1.4

[[b21-71]] 12.6 4.3

[[b21-72]] 3.1 1.7

[[b21-73]] 4.0 2.4

[[b21-74]] 6.1 3.1

[[b21-75]] 8.6 3.6

[[b21-76]] 15.4 13.4

[[b21-77]] 8.8 3.5

[[b21-78]] 15.6 46.9

[[b21-79]] 65.7 68.9

[[b21-80]] 70.3 71.3

[[b21-81]] 24.8 35.8

[[b21-82]] 72.7 87.1

[[b21-83]] 19.7 63.1

[[b21-84]] 69.9 76.4

[[b21-85]] 74.0 80.4

[[b21-86]] 29.5 45.3

[[b21-87]] 78.7 92.6

[[b21-88]] 4.9 4.1

[[b21-89]] 15.1 16.8

[[b21-90]] 23.7 25.2

[[b21-91]] 19.3 21.7

[[b21-92]] 26.2 30.5

[[b21-93]] 9.6 29.9

[[b21-94]] 48.2 46.7

[[b21-95]] 58.7 61.9

[[b21-96]] 25.6 22.4

[[b21-97]] 61.8 80.3

[[b21-98]] 17.9 56.9

[[b21-99]] 69.4 79.0

[[b21-100]] 72.1 73.9

[[b21-101]] 25.2 35.8

[[b21-102]] 79.2 93.3

[[b21-103]] SingleEq

[[b21-104]] AddSub

[[b21-105]] MultiArith

[[b21-106]] standard CoT standard CoT standard CoT standard CoT

[[b21-107]] 20B

[[b21-108]] 24.9 27.2

[[b21-109]] 18.0 20.2

[[b21-110]] 18.5 18.2

[[b21-111]] 5.0 10.7

[[b21-112]] 2.8 1.0

[[b21-113]] 2.4 0.4

[[b21-114]] 1.9 0.7

[[b21-115]] 5.8 1.5

[[b21-116]] 4.6 4.1

[[b21-117]] 2.4 3.3

[[b21-118]] 2.7 3.2

[[b21-119]] 5.8 1.8

[[b21-120]] 8.0 7.0

[[b21-121]] 4.5 4.4

[[b21-122]] 3.4 5.2

[[b21-123]] 5.2 2.4

[[b21-124]] 36.5 40.8

[[b21-125]] 23.9 26.0

[[b21-126]] 17.3 23.2

[[b21-127]] 8.7 32.4

[[b21-128]] 73.2 76.2

[[b21-129]] 48.8 58.7

[[b21-130]] 43.0 51.9

[[b21-131]] 7.6 44.9

[[b21-132]] 350M

[[b21-133]] 3.2 1.8

[[b21-134]] 2.0 0.2

[[b21-135]] 2.0 1.5

[[b21-136]] 2.3 0.8

[[b21-137]] 5.3 3.0

[[b21-138]] 2.4 1.6

[[b21-139]] 2.3 1.5

[[b21-140]] 2.2 0.5

[[b21-141]] 13.5 3.9

[[b21-142]] 8.7 4.9

[[b21-143]] 8.6 2.5

[[b21-144]] 4.5 2.8

[[b21-145]] 90.9 88.8

[[b21-146]] 82.7 86.6

[[b21-147]] 83.3 81.3

[[b21-148]] 33.8 91.7

[[b21-149]] 93.1 91.8

[[b21-150]] 86.8 93.1

[[b21-151]] 90.9 89.1

[[b21-152]] 44.0 96.2

[[b21-153]] 41.8 46.6

[[b21-154]] 29.5 28.2

[[b21-155]] 29.4 31.4

[[b21-156]] 4.2 15.8

[[b21-157]] 87.9 85.6

[[b21-158]] 77.2 83.5

[[b21-159]] 74.7 78.2

[[b21-160]] 7.3 73.7

[[b21-161]] 94.1 94.1

[[b21-162]] 86.5 92.3

[[b21-163]] 93.9 91.9

[[b21-164]] 42.2 94.7

[[b21-165]] 21

[[b22-1]] Table 4: Standard prompting versus chain of thought prompting on five commonsense reasoning benchmarks. Chain of thought prompting is an emergent ability of model scale—it does not positively impact performance until used with a model of sufficient scale.

[[b22-2]] CSQA

[[b22-3]] Model

[[b22-4]] 20B

[[b22-5]] LaMDA 420M

[[b22-6]] 2B

[[b22-7]] 8B

[[b22-8]] 68B

[[b22-9]] 137B

[[b22-10]] 350M

[[b22-11]] 1.3B

[[b22-12]] 6.7B

[[b22-13]] 175B

[[b22-14]] Codex -

[[b22-15]] PaLM 8B

[[b22-16]] 62B

[[b22-17]] 540B

[[b22-18]] Table 5: Standard prompting versus chain of thought prompting enables length generalization to longer inference examples on two symbolic manipulation tasks.

[[b22-19]] Last Letter Concatenation

[[b22-20]] 2

[[b22-21]] standard CoT standard CoT standard CoT standard CoT standard CoT standard CoT

[[b22-22]] 20B

[[b22-23]] LaMDA 420M 2B 8B 68B 137B

[[b22-24]] PaLM 8B 62B 540B

[[b22-25]] StrategyQA

[[b22-26]] Date

[[b22-27]] Sports

[[b22-28]] SayCan

[[b22-29]] standard CoT standard CoT standard CoT standard CoT standard CoT

[[b22-30]] UL2

[[b22-31]] 34.2 51.4

[[b22-32]] 59.0 53.3

[[b22-33]] 13.5 14.0

[[b22-34]] 57.9 65.3

[[b22-35]] 20.0 41.7

[[b22-36]] 20.1 19.2

[[b22-37]] 46.4 24.9

[[b22-38]] 1.9 1.6

[[b22-39]] 50.0 49.7

[[b22-40]] 7.5 7.5

[[b22-41]] 20.2 19.6

[[b22-42]] 52.6 45.2

[[b22-43]] 8.0 6.8

[[b22-44]] 49.3 57.5

[[b22-45]] 8.3 8.3

[[b22-46]] 19.0 20.3

[[b22-47]] 54.1 46.8

[[b22-48]] 9.5 5.4

[[b22-49]] 50.0 52.1

[[b22-50]] 28.3 33.3

[[b22-51]] 37.0 44.1

[[b22-52]] 59.6 62.2

[[b22-53]] 15.5 18.6

[[b22-54]] 55.2 77.5

[[b22-55]] 35.0 42.5

[[b22-56]] 53.6 57.9

[[b22-57]] 62.4 65.4

[[b22-58]] 21.5 26.8

[[b22-59]] 59.5 85.8

[[b22-60]] 43.3 46.6

[[b22-61]] GPT

[[b22-62]] 14.7 15.2

[[b22-63]] 20.6 0.9

[[b22-64]] 4.3 0.9

[[b22-65]] 33.8 41.6

[[b22-66]] 12.5 0.8

[[b22-67]] 12.0 19.2

[[b22-68]] 45.8 35.7

[[b22-69]] 4.0 1.4

[[b22-70]] 0.0 26.9

[[b22-71]] 20.8 9.2

[[b22-72]] 19.0 24.0

[[b22-73]] 53.6 50.0

[[b22-74]] 8.9 4.9

[[b22-75]] 0.0 4.4

[[b22-76]] 17.5 35.0

[[b22-77]] 79.5 73.5

[[b22-78]] 65.9 65.4

[[b22-79]] 43.8 52.1

[[b22-80]] 69.6 82.4

[[b22-81]] 81.7 87.5

[[b22-82]] 82.3 77.9

[[b22-83]] 67.1 73.2

[[b22-84]] 49.0 64.8

[[b22-85]] 71.7 98.5

[[b22-86]] 85.8 88.3

[[b22-87]] 19.8 24.9

[[b22-88]] 55.6 53.5

[[b22-89]] 12.9 13.1

[[b22-90]] 55.1 75.2

[[b22-91]] 34.2 40.0

[[b22-92]] 65.4 68.1

[[b22-93]] 58.4 63.4

[[b22-94]] 29.8 44.7

[[b22-95]] 72.1 93.6

[[b22-96]] 65.8 70.0

[[b22-97]] 78.1 79.9

[[b22-98]] 68.6 77.8

[[b22-99]] 49.0 65.3

[[b22-100]] 80.5 95.4

[[b22-101]] 80.8 91.7

[[b22-102]] Coin Flip (state tracking)

[[b22-103]] OOD: 3

[[b22-104]] OOD: 4

[[b22-105]] 2

[[b22-106]] OOD: 3

[[b22-107]] OOD: 4

[[b22-108]] Model

[[b22-109]] UL2

[[b22-110]] 0.6 18.8

[[b22-111]] 0.0 0.2

[[b22-112]] 0.0 0.0

[[b22-113]] 70.4 67.1

[[b22-114]] 51.6 52.2

[[b22-115]] 48.7 50.4

[[b22-116]] 0.3 1.6

[[b22-117]] 0.0 0.0

[[b22-118]] 0.0 0.0

[[b22-119]] 52.9 49.6

[[b22-120]] 50.0 50.5

[[b22-121]] 49.5 49.1

[[b22-122]] 2.3 6.0

[[b22-123]] 0.0 0.0

[[b22-124]] 0.0 0.0

[[b22-125]] 54.9 55.3

[[b22-126]] 47.4 48.7

[[b22-127]] 49.8 50.2

[[b22-128]] 1.5 11.5

[[b22-129]] 0.0 0.0

[[b22-130]] 0.0 0.0

[[b22-131]] 52.9 55.5

[[b22-132]] 48.2 49.6

[[b22-133]] 51.2 50.6

[[b22-134]] 4.4 52.0

[[b22-135]] 0.0 0.8

[[b22-136]] 0.0 2.5

[[b22-137]] 56.2 83.2

[[b22-138]] 50.4 69.1

[[b22-139]] 50.9 59.6

[[b22-140]] 5.8 77.5

[[b22-141]] 0.0 34.4

[[b22-142]] 0.0 13.5

[[b22-143]] 49.0 99.6

[[b22-144]] 50.7 91.0

[[b22-145]] 49.1 74.5

[[b22-146]] 2.6 18.8

[[b22-147]] 0.0 0.0

[[b22-148]] 0.0 0.2

[[b22-149]] 60.0 74.4

[[b22-150]] 47.3 57.1

[[b22-151]] 50.9 51.8

[[b22-152]] 6.8 85.0

[[b22-153]] 0.0 59.6

[[b22-154]] 0.0 13.4

[[b22-155]] 91.4 96.8

[[b22-156]] 43.9 91.0

[[b22-157]] 38.3 72.4

[[b22-158]] 7.6 99.4

[[b22-159]] 0.2 94.8

[[b22-160]] 0.0 63.0

[[b22-161]] 98.1 100.0

[[b22-162]] 49.3 98.6

[[b22-163]] 54.8 90.2

[[b22-164]] 22

[[b23-1]] Table 6: Ablation and robustness results for arithmetic reasoning datasets. Chain of thought generally outperforms ablations by a large amount. “Equation only” performs in between standard prompting and chain of thought prompting, as it allows for intermediate reasoning steps via equations but does not leverage natural language. Chain of thought prompting has variance (as expected) when used with prompts written by different annotators or when using other exemplars, but still outperforms standard prompting by a large margin. Standard deviation shown is for different order of few-shot prompting exemplars, with five different random seeds. Results here are shown for LaMDA 137B, as additional queries for GPT-3 and PaLM are both limited and expensive.

[[b23-2]] GSM8K SVAMP

[[b23-3]] Standard prompting

[[b23-4]] Chain of thought prompting

[[b23-5]] Ablations

[[b23-6]] · equation only

[[b23-7]] · variable compute only

[[b23-8]] · reasoning after answer

[[b23-9]] Robustness

[[b23-10]] · different annotator (B)

[[b23-11]] · different annotator (C)

[[b23-12]] · intentionally concise style

[[b23-13]] Table 7: Ablation and robustness results for four datasets in commonsense and symbolic reasoning. Chain of thought generally outperforms ablations by a large amount. Chain of thought prompting has variance (as expected) when used with prompts written by different annotators or when using other exemplars, but still outperforms standard prompting by a large margin. Standard deviation shown is for different order of few-shot prompting exemplars, with five different random seeds. Results here are shown for LaMDA 137B, as additional queries for GPT-3 and PaLM are both limited and expensive. The exception is that we run SayCan using PaLM here, as the SayCan evaluation set is only 120 examples and therefore less expensive to run multiple times.

[[b23-14]] Commonsense

[[b23-15]] Date

[[b23-16]] Standard prompting Chain of thought prompting 26.8 ±2.1 85.8 ±1.8 91.7 ±1.4 77.5 ±3.8

[[b23-17]] Ablations · variable compute only · reasoning after answer

[[b23-18]] Robustness · different annotator (B) · different annotator (C)

[[b23-19]] ASDiv MAWPS

[[b23-20]] 6.5 ±0.4 29.5 ±0.6 40.1 ±0.6 43.2 ±0.9

[[b23-21]] 14.3 ±0.4 36.7 ±0.4 46.6 ±0.7 57.9 ±1.5

[[b23-22]] 5.4 ±0.2 35.1 ±0.4 45.9 ±0.6 50.1 ±1.0

[[b23-23]] 6.4 ±0.3 28.0 ±0.6 39.4 ±0.4 41.3 ±1.1

[[b23-24]] 6.1 ±0.4 30.7 ±0.9 38.6 ±0.6 43.6 ±1.0

[[b23-25]] 15.5 ±0.6 35.2 ±0.4 46.5 ±0.4 58.2 ±1.0

[[b23-26]] 17.6 ±1.0 37.5 ±2.0 48.7 ±0.7 60.1 ±2.0

[[b23-27]] 11.1 ±0.3 38.7 ±0.8 48.0 ±0.3 59.6 ±0.7

[[b23-28]] · exemplars from GSM8K (α) 12.6 ±0.6 32.8 ±1.1 44.1 ±0.9 53.9 ±1.1

[[b23-29]] · exemplars from GSM8K (β) 12.7 ±0.5 34.8 ±1.1 46.9 ±0.6 60.9 ±0.8

[[b23-30]] · exemplars from GSM8K (γ) 12.6 ±0.7 35.6 ±0.5 44.4 ±2.6 54.2 ±4.7

[[b23-31]] Symbolic

[[b23-32]] Sports

[[b23-33]] SayCan

[[b23-34]] Concat

[[b23-35]] Coin

[[b23-36]] 21.5 ±0.6 59.5 ±3.0 80.8 ±1.8

[[b23-37]] 5.8 ±0.6

[[b23-38]] 49.0 ±2.1

[[b23-39]] 99.6 ±0.3

[[b23-40]] 21.3 ±0.7 61.6 ±2.2 74.2 ±2.3

[[b23-41]] 7.2 ±1.6

[[b23-42]] 50.7 ±0.7

[[b23-43]] 20.9 ±1.0 63.0 ±2.0 83.3 ±0.6

[[b23-44]] 0.0 ±0.0

[[b23-45]] 50.2 ±0.5

[[b23-46]] 27.4 ±1.7 75.4 ±2.7 88.3 ±1.4 76.0 ±1.9

[[b23-47]] 77.5 ±7.9

[[b23-48]] 25.5 ±2.5 81.1 ±3.6 85.0 ±1.8 68.1 ±2.2 71.4 ±11.1

[[b23-49]] 23
