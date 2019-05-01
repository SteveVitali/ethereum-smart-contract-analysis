#!/bin/bash

cat nohup.out

echo "Total Analysis Progress:"
ls ethereumetl/export/contracts_analysis

echo "Analyzing range: ${START_BLOCK} - ${END_BLOCK}"

# Default batch size = 10000
batch_size=${BATCH_SIZE:=10000}

for (( s=$START_BLOCK; s <= $END_BLOCK; s+=$batch_size )); do
	e=(s + batch_size - 1)
	START=start_block=0${s}
	END=end_block=0${e}
	CSV=contracts_0${s}_0${e}.csv

	echo "Num Contracts in ${s}-${e}:"
	wc -l ethereumetl/export/contracts/${START}/${END}/${CSV}

done
