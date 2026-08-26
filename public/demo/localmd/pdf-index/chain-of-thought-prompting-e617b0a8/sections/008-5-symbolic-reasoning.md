<!-- section 008 · pages 8–8 · raw/papers/chain-of-thought-prompting.pdf -->
# [[b8-1]] 5 Symbolic Reasoning

[[b8-2]] Our final experimental evaluation considers symbolic reasoning, which is simple for humans but potentially challenging for language models. We show that chain-ofthought prompting not only enables language models to perform symbolic reasoning tasks that are challenging in the standard prompting setting, but also facilitates length generalization to inference-time inputs longer than those seen in the few-shot exemplars.

[[b8-3]] Tasks. We use the following two toy tasks.

[[b8-4]] Coin Flip: 2 • Last letter concatenation. This task asks the model

[[b8-5]] to concatenate the last letters of words in a name (e.g., “Amy Brown” → “yn”). It is a more challenging version

[[b8-6]] of first letter concatenation, which language models can

[[b8-7]] already perform without chain of thought.3 We generate

[[b8-8]] full names by randomly concatenating names from the

[[b8-9]] top one-thousand first and last names from name census

[[b8-10]] data (https://namecensus.com/). • Coin flip. This task asks the model to answer whether a

[[b8-11]] coin is still heads up after people either flip or don’t flip

[[b8-12]] the coin (e.g., “A coin is heads up. Phoebe flips the coin.

[[b8-13]] Osvaldo does not flip the coin. Is the coin still heads up?” Figure 8:

[[b8-14]] → “no”). As the construction of these symbolic reasoning tasks is longer sequences in two symbolic reawell-defined, for each task we consider an in-domain test soning tasks. set for which examples had the same number of steps as the training/few-shot exemplars, as well as an out-of-domain (OOD) test set, for which evaluation examples had more steps than those in the exemplars. For last letter concatenation, the model only sees exemplars of names with two words, and then performs last letter concatenation on names with 3 and 4 words.4 We do the same for the number of potential flips in the coin flip task. Our experimental setup uses the same methods and models as in the prior two sections. We again manually compose chains of thought for the few-shot exemplars for each task, which are given in Figure 3.

[[b8-15]] Results. The results of these in-domain and OOD evaluations are shown in Figure 8 for PaLM, with results for LaMDA shown in Appendix Table 5. With PaLM 540B, chain-of-thought prompting leads to almost 100% solve rates (note that standard prompting already solves coin flip with PaLM 540, though not for LaMDA 137B). Note that these in-domain evaluations are “toy tasks” in the sense that perfect solution structures are already provided by the chains of thought in the few-shot exemplars; all the model has to do is repeat the same steps with the new symbols in the test-time example. And yet, small models still fail—the ability to perform abstract manipulations on unseen symbols for these three tasks only arises at the scale of 100B model parameters.

[[b8-16]] As for the OOD evaluations, standard prompting fails for both tasks. With chain-of-thought prompting, language models achieve upward scaling curves (though performance is lower than in the in-domain setting). Hence, chain-of-thought prompting facilitates length generalization beyond seen chains of thought for language models of sufficient scale.

## [[b8-17]] 6 Discussion

[[b8-18]] We have explored chain-of-thought prompting as a simple mechanism for eliciting multi-step reasoning behavior in large language models. We first saw that chain-of-thought prompting improves performance by a large margin on arithmetic reasoning, yielding improvements that are much stronger than ablations and robust to different annotators, exemplars, and language models (Section 3). Next,

[[b8-19]] 3We tested 10 common names using GPT-3 davinci and it got all but one correct.

[[b8-20]] 4For names of length longer than 2 words, we concatenate multiple first and last names together.

[[b8-21]] 8

[[b8-22]] Standard prompting

[[b8-23]] Chain-of-thought prompting

[[b8-24]] Letter Concat: 2 Letter Concat: 4

[[b8-25]] (in domain)

[[b8-26]] (OOD)

[[b8-27]] 100

[[b8-28]] 75

[[b8-29]] 50

[[b8-30]] 25

[[b8-31]] Solve rate (%)

[[b8-32]] 0

[[b8-33]] Coin Flip: 4

[[b8-34]] (in domain)

[[b8-35]] (OOD)

[[b8-36]] 100

[[b8-37]] 80

[[b8-38]] 60

[[b8-39]] Solve rate (%)

[[b8-40]] 40

[[b8-41]] 8 62 540 8 62 540

[[b8-42]] Model scale (# parameters in billions)

[[b8-43]] Using chain-of-thought

[[b8-44]] prompting facilitates generalization to
